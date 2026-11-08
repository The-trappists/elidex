"""Per-workspace limits for the public demo, propagated into worker threads."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR
from pathlib import Path
from typing import Any, Callable, Iterator


class DemoLimitError(RuntimeError):
    """A public workspace is scripted or has exhausted its live allowance."""


def euros_to_micro(value: str | Decimal) -> int:
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid euro budget amount") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError("Budget limits must be finite non-negative euro amounts")
    return int((amount * 1_000_000).to_integral_value(rounding=ROUND_FLOOR))


@dataclass(frozen=True)
class ModelPrice:
    """Conservative, all-in EUR prices per million billable tokens."""

    input: Decimal
    output: Decimal

    def cost_micro(self, input_tokens: int, output_tokens: int) -> int:
        # EUR / million tokens * tokens * million microEUR / EUR.
        return int((self.input * input_tokens + self.output * output_tokens).to_integral_value(rounding=ROUND_CEILING))


class PriceCatalog:
    def __init__(self, raw: str = ""):
        self.prices: dict[str, ModelPrice] = {}
        self.error: str | None = None
        if not raw.strip():
            self.error = "Live AI pricing has not been configured. Scripted exploration remains available."
            return
        try:
            data = json.loads(raw, parse_float=Decimal)
            if not isinstance(data, dict) or not data:
                raise ValueError()
            for key, row in data.items():
                if not isinstance(key, str) or "|" not in key or not isinstance(row, dict):
                    raise ValueError()
                # Operators must verify that the API's output limit covers thinking too.
                if row.get("output_cap_includes_reasoning") is not True:
                    raise ValueError()
                rates = []
                for name in ("input", "output"):
                    if isinstance(row.get(name), bool):
                        raise ValueError()
                    rate = Decimal(str(row[name]))
                    if not rate.is_finite() or rate < 0:
                        raise ValueError()
                    rates.append(rate)
                base_url, model = key.rsplit("|", 1)
                self.prices[self.key(base_url, model)] = ModelPrice(*rates)
        except (ValueError, TypeError, KeyError, InvalidOperation):
            self.prices.clear()
            self.error = "Live AI pricing configuration is invalid. Scripted exploration remains available."

    @staticmethod
    def key(base_url: str, model: str) -> str:
        return f"{base_url.rstrip('/')}|{model.removeprefix('google/')}"

    def get(self, base_url: str, model: str) -> ModelPrice:
        if self.error:
            raise DemoLimitError(self.error)
        price = self.prices.get(self.key(base_url, model))
        if price is None:
            raise DemoLimitError("Pricing for a configured live model is missing. Scripted exploration remains available.")
        return price


class BudgetLedger:
    """Crash-safe reservations shared across workspaces and server processes.

    Unsettled reservations remain held after crashes and missing usage reports.
    The database must live outside workspace directories, on a persistent volume.
    """

    def __init__(self, path: Path, *, workspace_limit: str = "0.50", global_limit: str = "100"):
        self.path = Path(path)
        self.workspace_limit = min(500_000, euros_to_micro(workspace_limit))
        self.global_limit = min(100_000_000, euros_to_micro(global_limit))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS reservations (
                id TEXT PRIMARY KEY, workspace TEXT NOT NULL, reserved INTEGER NOT NULL,
                charged INTEGER, overrun INTEGER NOT NULL DEFAULT 0)""")
            db.execute("CREATE INDEX IF NOT EXISTS reservation_workspace ON reservations(workspace)")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _totals(db, workspace: str | None = None):
        where, args = (" WHERE workspace = ?", (workspace,)) if workspace is not None else ("", ())
        return db.execute("SELECT COALESCE(SUM(CASE WHEN charged IS NULL THEN reserved ELSE 0 END),0), "
                          "COALESCE(SUM(charged),0), COALESCE(MAX(overrun),0) FROM reservations" + where, args).fetchone()

    def reserve(self, workspace: str, amount: int) -> str:
        if amount < 0:
            raise ValueError("Negative reservation")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            global_reserved, global_spent, overrun = self._totals(db)
            reserved, spent, _ = self._totals(db, workspace)
            if overrun:
                raise DemoLimitError("Live AI is paused because provider usage exceeded its configured bound.")
            if reserved + spent + amount > self.workspace_limit:
                raise DemoLimitError("Your live AI budget is exhausted. Continue exploring in scripted mode.")
            if global_reserved + global_spent + amount > self.global_limit:
                raise DemoLimitError("The shared live AI budget is exhausted. Continue exploring in scripted mode.")
            ident = uuid.uuid4().hex
            db.execute("INSERT INTO reservations(id, workspace, reserved) VALUES(?,?,?)", (ident, workspace, amount))
            return ident

    def settle(self, ident: str, actual: int) -> None:
        if actual < 0:
            raise ValueError("Negative charge")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT reserved, charged FROM reservations WHERE id=?", (ident,)).fetchone()
            if row is None or row[1] is not None:
                return
            # A violated provider bound is recorded honestly and pauses all future calls.
            db.execute("UPDATE reservations SET charged=?, overrun=? WHERE id=?", (actual, int(actual > row[0]), ident))

    def snapshot(self, workspace: str) -> dict[str, Any]:
        with self._connect() as db:
            db.execute("BEGIN")
            reserved, spent, _ = self._totals(db, workspace)
            total_reserved, total_spent, overrun = self._totals(db)
        remaining = max(0, self.workspace_limit - reserved - spent)
        global_remaining = max(0, self.global_limit - total_reserved - total_spent)
        return {
            "budget_limit_eur": self.workspace_limit / 1_000_000,
            "budget_spent_eur": spent / 1_000_000,
            "budget_reserved_eur": reserved / 1_000_000,
            "budget_remaining_eur": remaining / 1_000_000,
            "global_budget_remaining_eur": global_remaining / 1_000_000,
            "global_budget_limit_eur": self.global_limit / 1_000_000,
            "budget_available": bool(remaining and global_remaining and not overrun),
        }


@dataclass
class DemoPolicy:
    trace_sink: Callable[[dict[str, Any]], None] | None = None
    max_calls: int = 12
    max_output_tokens: int = 4096
    max_input_chars: int = 24000
    ledger: BudgetLedger | None = None
    prices: PriceCatalog | None = None
    workspace_id: str = ""
    budget_required: bool = False
    budget_error: str | None = field(default=None, init=False)
    calls: int = field(default=0, init=False)
    used: bool = field(default=False, init=False)
    active: bool = field(default=False, init=False)
    deadline: float = field(default=0.0, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def start_run(self, seconds: float = 60) -> None:
        with self._lock:
            if self.used:
                raise DemoLimitError("Your live run has already been used. Scripted exploration remains available.")
            self.used = True
            self.active = True
            self.deadline = time.monotonic() + max(0.0, min(seconds, 60.0))

    def finish_run(self) -> None:
        with self._lock:
            self.active = False

    def _check(self) -> None:
        if not _live.get() or not self.active or time.monotonic() >= self.deadline or self.calls >= self.max_calls:
            raise DemoLimitError("Live API access is unavailable. Continue exploring in scripted mode.")

    def require_active(self) -> None:
        with self._lock:
            self._check()

    def reserve(self, system: str, user: str) -> float:
        """Reserve one provider attempt, including repairs and fallback attempts."""
        with self._lock:
            self._check()
            if len(system) + len(user) > self.max_input_chars:
                raise DemoLimitError("This request exceeds the live demo context limit.")
            self.calls += 1
            return max(0.001, self.deadline - time.monotonic())

    def reserve_budget(self, base_url: str, model: str, request: dict[str, Any]) -> tuple[str, ModelPrice] | None:
        if self.ledger is None or self.prices is None:
            if self.budget_required:
                raise DemoLimitError("Live AI budgeting is unavailable. Scripted exploration remains available.")
            return None
        try:
            price = self.prices.get(base_url, model)
            # UTF-8 bytes bound ordinary text tokenization conservatively. Include the
            # schema and all serialized request fields, plus framing-token headroom.
            maximum_input = len(json.dumps(request, ensure_ascii=False).encode("utf-8")) + 2048
            amount = price.cost_micro(maximum_input, min(4096, self.max_output_tokens))
            return self.ledger.reserve(self.workspace_id, amount), price
        except DemoLimitError as exc:
            self.budget_error = str(exc)
            raise

    def settle_budget(self, reservation: tuple[str, ModelPrice] | None, usage: dict[str, Any]) -> None:
        if reservation is None or self.ledger is None:
            return
        inputs, outputs = usage.get("prompt_tokens"), usage.get("completion_tokens")
        if type(inputs) is not int or type(outputs) is not int or inputs < 0 or outputs < 0:
            return  # Missing or invalid usage: keep the full reservation.
        ident, price = reservation
        self.ledger.settle(ident, price.cost_micro(inputs, outputs))

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "used": self.used,
                "active": self.active and time.monotonic() < self.deadline and self.calls < self.max_calls,
                "calls": self.calls,
                "max_calls": self.max_calls,
                "remaining_calls": max(0, self.max_calls - self.calls),
            }


_policy: ContextVar[DemoPolicy | None] = ContextVar("demo_policy", default=None)
_live: ContextVar[bool] = ContextVar("demo_live_permission", default=False)


def current_policy() -> DemoPolicy | None:
    return _policy.get()


@contextmanager
def bind_policy(policy: DemoPolicy, *, allow_live: bool = False) -> Iterator[DemoPolicy]:
    token = _policy.set(policy)
    live_token = _live.set(allow_live)
    try:
        yield policy
    finally:
        _live.reset(live_token)
        _policy.reset(token)
