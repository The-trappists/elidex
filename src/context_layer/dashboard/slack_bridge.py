"""Slack bridge (Socket Mode): mirrors Dashboard chats to a Slack channel and reads human replies back."""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

from .contracts import LiveThread, Message
from .state import Dashboard

log = logging.getLogger(__name__)

IGNORED_SUBTYPES = {"bot_message", "message_changed", "message_deleted", "channel_join"}
SOURCE_LABEL = {"teams": "[Teams] ", "email": "[Email] "}


class SlackBridge:
    def __init__(self, wb: Dashboard, bot_token: str, app_token: str, channel_id: str):
        self.wb = wb
        self.bot_token = bot_token
        self.app_token = app_token
        self.channel_id = channel_id
        self.connected = False
        self.error: str | None = None
        self.channel_name: str | None = None
        self.bot_user_id: str | None = None
        self.bot_id: str | None = None
        self.client = AsyncWebClient(token=bot_token)  # tests replace this with a mock
        self.min_interval = 1.0  # seconds between posts (Slack: ~1 message/s/channel)
        self.queue: asyncio.Queue = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._handler = None
        self._users: dict[str, tuple[str, str | None]] = {}

    # ------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        try:
            from slack_bolt.adapter.socket_mode.aiohttp import AsyncSocketModeHandler
            from slack_bolt.async_app import AsyncApp

            auth = await self.client.auth_test()
            self.bot_user_id = auth.get("user_id")
            self.bot_id = auth.get("bot_id")
            info = await self.client.conversations_info(channel=self.channel_id)
            self.channel_name = info["channel"].get("name")

            # Socket Mode has no HTTP signing secret, so request verification is off.
            app = AsyncApp(client=self.client, request_verification_enabled=False)

            @app.event("message")
            async def _on_message(event):
                await self.handle_slack_event(event)

            self._handler = AsyncSocketModeHandler(app, self.app_token)
            await self._handler.connect_async()
            self._worker = asyncio.create_task(self._run_worker())
            self.wb.add_message_listener(self._on_wb_message)
            self.connected = True
            self.error = None
            self.wb.settings.slack_connected = True
        except Exception as exc:  # never raise
            self.connected = False
            self.error = _describe(exc)
            log.warning("Slack bridge failed to start: %s", self.error)
        self.wb.emit("slack.status", self.status())

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()
            self._worker = None
        try:
            if self._handler:
                await self._handler.close_async()
        except Exception as exc:
            log.warning("Slack disconnect failed: %s", exc)
        self.connected = False
        self.wb.settings.slack_connected = False
        self.wb.emit("slack.status", self.status())

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "channel": f"#{self.channel_name}" if self.channel_name else None,
            "error": self.error,
        }

    # ------------------------------------------------------------ outbound (Dashboard -> Slack)

    def _on_wb_message(self, thread: LiveThread, message: Message, mirror: bool) -> None:
        """Called synchronously on the loop thread: only enqueue."""
        if not mirror or not self.wb.settings.slack_mirror:
            return
        self.queue.put_nowait((thread.id, message))

    async def _run_worker(self) -> None:
        while True:
            thread_id, message = await self.queue.get()
            try:
                await self.send_message(thread_id, message)
            except Exception as exc:
                log.warning("Slack post failed: %s", _describe(exc))
                self.error = _describe(exc)
                self.wb.emit("slack.status", self.status())
            finally:
                self.queue.task_done()
            await asyncio.sleep(self.min_interval)

    async def send_message(self, thread_id: str, message: Message) -> None:
        thread = self.wb.threads.get(thread_id)
        if thread is None:
            return
        persona = self.wb.persona_by_name(message.author)
        color = (persona.avatar_color if persona else "#6366f1").lstrip("#")
        username = f"{message.author} · {message.role}" if message.role else message.author
        text = message.text
        kwargs: dict = {}
        if thread.slack_ts:
            kwargs["thread_ts"] = thread.slack_ts
        else:
            label = SOURCE_LABEL.get(thread.source, "")
            if label and thread.subject:
                text = f"{label}{thread.subject}\n{text}"
            else:
                text = label + text
        resp = await self._post(
            channel=self.channel_id,
            text=text,
            username=username,
            icon_url=f"https://api.dicebear.com/9.x/initials/png?seed={quote(message.author)}&backgroundColor={color}",
            **kwargs,
        )
        if not thread.slack_ts and resp.get("ts"):
            self.wb.set_thread_slack_ts(thread_id, resp["ts"])

    async def _post(self, **kwargs):
        """chat.postMessage with one retry after Retry-After on rate limiting."""
        for attempt in range(3):
            try:
                return await self.client.chat_postMessage(**kwargs)
            except SlackApiError as exc:
                if exc.response.get("error") == "ratelimited" and attempt < 2:
                    wait = float(exc.response.headers.get("Retry-After", 1))
                    await asyncio.sleep(wait)
                    continue
                raise

    # ------------------------------------------------------------ inbound (Slack -> Dashboard)

    async def handle_slack_event(self, event: dict) -> None:
        if event.get("channel") != self.channel_id:
            return
        if event.get("bot_id") or event.get("subtype") in IGNORED_SUBTYPES:
            return
        if self.bot_user_id and event.get("user") == self.bot_user_id:
            return
        text = (event.get("text") or "").strip()
        user = event.get("user")
        if not text or not user:
            return
        name, title = await self._user(user)

        ts = event.get("ts")
        root_ts = event.get("thread_ts")
        thread = self.wb.thread_by_slack_ts(root_ts) if root_ts and root_ts != ts else None
        if thread is None:
            thread = self.wb.create_thread(
                source="slack", subject=text[:60], participants=[name], origin="slack"
            )
            self.wb.set_thread_slack_ts(thread.id, root_ts or ts)
        self.wb.post_message(thread.id, author=name, text=text, role=title, mirror=False)

    async def _user(self, user_id: str) -> tuple[str, str | None]:
        if user_id not in self._users:
            try:
                info = await self.client.users_info(user=user_id)
                u = info["user"]
                profile = u.get("profile", {})
                name = profile.get("display_name") or u.get("real_name") or u.get("name") or user_id
                self._users[user_id] = (name, profile.get("title") or None)
            except Exception as exc:
                log.warning("users.info failed for %s: %s", user_id, exc)
                return user_id, None
        return self._users[user_id]


def _describe(exc: Exception) -> str:
    if isinstance(exc, SlackApiError):
        return str(exc.response.get("error", exc))
    return f"{type(exc).__name__}: {exc}"
