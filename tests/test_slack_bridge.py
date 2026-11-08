import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from context_layer.dashboard.contracts import LiveThread, Message
from context_layer.dashboard.slack_bridge import SlackBridge

CH = "C1"


class FakeWb:
    def __init__(self):
        self.settings = SimpleNamespace(slack_mirror=True, slack_connected=False)
        self.threads: dict[str, LiveThread] = {}
        self.events: list = []
        self.posted: list = []
        self.listeners = []
        self.personas = {"Erkki": SimpleNamespace(avatar_color="#112233")}

    def emit(self, type, data):
        self.events.append((type, data))

    def persona_by_name(self, name):
        return self.personas.get(name)

    def add_message_listener(self, fn):
        self.listeners.append(fn)

    def create_thread(self, source, subject, participants, origin, **kw):
        t = LiveThread(id=f"live/{len(self.threads)}", source=source, subject=subject,
                       participants=participants, origin=origin, created_at=datetime(2026, 1, 1))
        self.threads[t.id] = t
        return t

    def set_thread_slack_ts(self, thread_id, ts):
        self.threads[thread_id].slack_ts = ts

    def thread_by_slack_ts(self, ts):
        return next((t for t in self.threads.values() if t.slack_ts == ts), None)

    def post_message(self, thread_id, author, text, role=None, mirror=True, **kw):
        self.posted.append((thread_id, author, text, role, mirror))


def make(source="teams", subject="Link down"):
    wb = FakeWb()
    b = SlackBridge(wb, "xoxb", "xapp", CH)
    b.min_interval = 0
    b.client = MagicMock()
    b.client.chat_postMessage = AsyncMock(side_effect=[{"ts": "1.1"}, {"ts": "1.2"}, {"ts": "1.3"}])
    b.client.users_info = AsyncMock(return_value={"user": {"real_name": "Anna", "profile": {"title": "Engineer"}}})
    t = wb.create_thread(source, subject, [], "synthetic")
    return wb, b, t


def msg(author="Erkki", role="Network Expert", text="hi"):
    return Message(thread_id="live/0", source="teams", seq=1, author=author, text=text, role=role, sent_at=datetime(2026, 1, 1))


def test_root_then_reply():
    async def go():
        wb, b, t = make()
        await b.send_message(t.id, msg(text="first"))
        await b.send_message(t.id, msg(text="second"))
        first, second = b.client.chat_postMessage.await_args_list
        assert "thread_ts" not in first.kwargs
        assert first.kwargs["text"].startswith("[Teams] Link down")
        assert t.slack_ts == "1.1"
        assert second.kwargs["thread_ts"] == "1.1"
        assert second.kwargs["text"] == "second"
        assert first.kwargs["username"] == "Erkki · Network Expert"
        assert "backgroundColor=112233" in first.kwargs["icon_url"]

    asyncio.run(go())


def test_mirror_false_ignored():
    wb, b, t = make()
    b._on_wb_message(t, msg(), False)
    assert b.queue.empty()
    wb.settings.slack_mirror = False
    b._on_wb_message(t, msg(), True)
    assert b.queue.empty()
    wb.settings.slack_mirror = True
    b._on_wb_message(t, msg(), True)
    assert b.queue.qsize() == 1


def test_inbound_top_level_creates_thread():
    async def go():
        wb, b, _ = make()
        await b.handle_slack_event({"channel": CH, "user": "U1", "text": "Hello there", "ts": "9.9"})
        t = wb.thread_by_slack_ts("9.9")
        assert t.source == "slack" and t.origin == "slack" and t.subject == "Hello there"
        assert wb.posted == [(t.id, "Anna", "Hello there", "Engineer", False)]

    asyncio.run(go())


def test_inbound_reply_goes_to_thread():
    async def go():
        wb, b, t = make()
        t.slack_ts = "5.5"
        await b.handle_slack_event({"channel": CH, "user": "U1", "text": "answer", "ts": "6.6", "thread_ts": "5.5"})
        assert wb.posted == [(t.id, "Anna", "answer", "Engineer", False)]
        assert len(wb.threads) == 1

    asyncio.run(go())


def test_bot_echo_and_other_channel_ignored():
    async def go():
        wb, b, _ = make()
        await b.handle_slack_event({"channel": CH, "bot_id": "B1", "text": "x", "ts": "1"})
        await b.handle_slack_event({"channel": CH, "subtype": "message_changed", "user": "U1", "text": "x", "ts": "1"})
        await b.handle_slack_event({"channel": "OTHER", "user": "U1", "text": "x", "ts": "1"})
        assert wb.posted == [] and len(wb.threads) == 1

    asyncio.run(go())


def test_start_failure_sets_error():
    async def go():
        wb, b, _ = make()
        b.client.auth_test = AsyncMock(side_effect=RuntimeError("boom"))
        await b.start()
        assert not b.connected and "boom" in b.error
        assert wb.events[-1][0] == "slack.status" and wb.events[-1][1]["error"] == b.error
        assert wb.settings.slack_connected is False

    asyncio.run(go())


def test_start_builds_real_bolt_app(monkeypatch):
    """Regression: AsyncApp must accept our kwargs (a bad kwarg silently disabled Slack in prod)."""
    from slack_bolt.adapter.socket_mode.aiohttp import AsyncSocketModeHandler
    from slack_sdk.web.async_client import AsyncWebClient

    monkeypatch.setattr(AsyncSocketModeHandler, "connect_async", AsyncMock())

    async def go():
        wb, b, _ = make()
        b.client = AsyncWebClient(token="xoxb-test")  # Bolt requires the real client type
        b.client.auth_test = AsyncMock(return_value={"user_id": "UBOT", "bot_id": "BBOT"})
        b.client.conversations_info = AsyncMock(return_value={"channel": {"name": "dashboard"}})
        await b.start()
        assert b.connected and b.error is None
        await b.stop()

    asyncio.run(go())
