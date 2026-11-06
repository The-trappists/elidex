"""Slack bridge (Socket Mode). PHASE 0 STUB. Owner: slack-bridge agent."""

from __future__ import annotations

from .state import Workbench


class SlackBridge:
    def __init__(self, wb: Workbench, bot_token: str, app_token: str, channel_id: str):
        self.wb = wb
        self.connected = False
        self.error: str | None = None

    async def start(self) -> None:
        """Connect, register wb.add_message_listener(...), emit slack.status. Never raises: on failure
        set self.error, emit slack.status with the error, and return."""
        raise NotImplementedError

    async def stop(self) -> None:
        raise NotImplementedError

    def status(self) -> dict:
        """{"connected": bool, "channel": str | None, "error": str | None}"""
        raise NotImplementedError
