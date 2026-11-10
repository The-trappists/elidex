"""Connection API: personal AI provider and Slack channel for one workspace.

Routes are mounted by both the team dashboard and the public demo. Credentials are accepted
only in the request body, tested against a fixed provider endpoint, and kept in memory.
Responses never echo a token or an upstream error body.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from ..connections import (
    PROVIDERS,
    AiConnection,
    describe_provider_error,
    sanitize,
    test_ai_connection,
)
from .slack_bridge import SlackBridge

router = APIRouter(prefix="/api/connections", tags=["connections"])

ProviderName = Literal["gemini", "mistral", "groq", "openai", "featherless"]


class AiConnectBody(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True, extra="forbid")

    provider: ProviderName
    model: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
    api_key: SecretStr

    @field_validator("api_key")
    @classmethod
    def _valid_key(cls, value: SecretStr) -> SecretStr:
        key = value.get_secret_value().strip()
        if len(key) < 8 or len(key) > 512 or any(ch.isspace() for ch in key):
            raise ValueError("The API key is not valid.")
        return value


class SlackConnectBody(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True, extra="forbid")

    bot_token: SecretStr
    app_token: SecretStr
    channel_id: str = Field(min_length=8, max_length=64, pattern=r"^[CGD][A-Z0-9]{6,}$")

    @field_validator("bot_token")
    @classmethod
    def _bot_token(cls, value: SecretStr) -> SecretStr:
        token = value.get_secret_value().strip()
        if not token.startswith("xoxb-") or len(token) < 12:
            raise ValueError("The bot token must be a Slack bot token (xoxb-...).")
        return value

    @field_validator("app_token")
    @classmethod
    def _app_token(cls, value: SecretStr) -> SecretStr:
        token = value.get_secret_value().strip()
        if not token.startswith("xapp-") or len(token) < 12:
            raise ValueError("The app token must be a Slack app-level token (xapp-...).")
        return value


def _wb(request: Request):
    return request.app.state.wb


def _registry(request: Request):
    return _wb(request).connections


@router.get("")
async def connections(request: Request) -> dict:
    return _registry(request).snapshot()


@router.post("/ai")
async def connect_ai(body: AiConnectBody, request: Request) -> dict:
    registry = _registry(request)
    token = registry.begin_ai_mutation()
    key = body.api_key.get_secret_value().strip()
    try:
        await asyncio.to_thread(test_ai_connection, body.provider, body.model, key)
    except Exception as exc:  # noqa: BLE001 - sanitized, never the upstream body
        raise HTTPException(502, describe_provider_error(exc, (key,))) from None
    connection = AiConnection(
        provider=body.provider,
        model=body.model,
        base_url=PROVIDERS[body.provider],
        api_key=key,
    )
    if not await registry.install_ai(token, connection):
        raise HTTPException(409, "A newer connection change replaced this request. Refresh and try again.")
    _wb(request).refresh_readonly_settings()
    return registry.snapshot()


@router.delete("/ai")
async def disconnect_ai(request: Request) -> dict:
    registry = _registry(request)
    token = registry.begin_ai_mutation()
    await registry.clear_ai(token)
    _wb(request).refresh_readonly_settings()
    return registry.snapshot()


@router.post("/slack")
async def connect_slack(body: SlackConnectBody, request: Request) -> dict:
    registry = _registry(request)
    wb = _wb(request)
    token = registry.begin_slack_mutation()
    bot_token = body.bot_token.get_secret_value().strip()
    app_token = body.app_token.get_secret_value().strip()
    bridge = SlackBridge(wb, bot_token, app_token, body.channel_id)
    await bridge.start()
    if not bridge.connected:
        error = sanitize(bridge.error, (bot_token, app_token))
        await bridge.stop()
        raise HTTPException(502, error)
    old, installed = await registry.install_slack(token, bridge)
    if not installed:
        await bridge.stop()
        raise HTTPException(409, "A newer connection change replaced this request. Refresh and try again.")
    if old is not None:
        try:
            await old.stop()
        except Exception:  # noqa: BLE001 - the new bridge is already installed
            pass
    wb.slack = bridge
    if registry.public_demo:
        # The demo middleware exposes a per-workspace state object; the test and the UI read it.
        request.app.state.slack = bridge
    wb.refresh_readonly_settings()
    wb.emit("slack.status", bridge.status())
    return registry.snapshot()


@router.delete("/slack")
async def disconnect_slack(request: Request) -> dict:
    registry = _registry(request)
    wb = _wb(request)
    token = registry.begin_slack_mutation()
    old, applied = await registry.clear_slack(token)
    if applied:
        if old is not None:
            try:
                await old.stop()
            except Exception:  # noqa: BLE001 - the registry is already disconnected
                pass
        wb.slack = registry.server_slack
        if registry.public_demo:
            request.app.state.slack = registry.server_slack
        wb.refresh_readonly_settings()
        wb.emit("slack.status", wb.slack.status() if wb.slack is not None else {"connected": False, "channel": None, "error": None})
    return registry.snapshot()
