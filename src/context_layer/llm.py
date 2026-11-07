"""Thin wrapper over any OpenAI-compatible chat endpoint (Gemini, Featherless, Snowflake Cortex...).

- JSON mode per provider: "json_object", "json_schema" or "prompt" (LLM_JSON_MODE).
- Optional fallback provider on 429, 5xx, timeout or connection error (LLM_FALLBACK_*).
- Every attempt is traced as an LlmCall dict and handed to the registered sinks
  (the workbench writes them to out/workbench/llm_calls.jsonl). API keys are never traced.

Sinks run in the caller's thread: a sink that touches an asyncio loop must use call_soon_threadsafe.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Literal

import openai
from openai import OpenAI

from . import config

TraceSink = Callable[[dict[str, Any]], None]
_sinks: list[TraceSink] = []


def add_trace_sink(sink: TraceSink) -> None:
    _sinks.append(sink)


def remove_trace_sink(sink: TraceSink) -> None:
    if sink in _sinks:
        _sinks.remove(sink)


def jsonl_sink(path: Path) -> TraceSink:
    """A sink that appends each trace as one JSON line (thread-safe)."""
    lock = threading.Lock()

    def sink(trace: dict[str, Any]) -> None:
        with lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(trace, ensure_ascii=False) + "\n")

    return sink


@dataclass
class Provider:
    name: str  # "primary" or "fallback" (a critic provider is named "critic" / "critic_fallback")
    base_url: str
    api_key: str
    model: str
    json_mode: str
    reasoning_effort: str = ""
    role: str = "primary"  # "primary" or "critic"
    role_note: str = ""  # e.g. "critic not configured: used primary"


Role = Literal["primary", "critic"]


def providers(role: Role = "primary", model: str | None = None) -> list[Provider]:
    """Provider chain for a role. An unconfigured critic falls back to the primary chain (noted in role_note)."""
    if role == "critic":
        out = []
        if config.llm_critic_configured():
            out.append(
                Provider("critic", config.LLM_CRITIC_BASE_URL, config.LLM_CRITIC_API_KEY, config.LLM_CRITIC_MODEL,
                         config.LLM_CRITIC_JSON_MODE, config.LLM_CRITIC_REASONING_EFFORT, role="critic")
            )
        if config.llm_critic_fallback_configured():
            out.append(
                Provider("critic_fallback", config.LLM_CRITIC_FALLBACK_BASE_URL, config.LLM_CRITIC_FALLBACK_API_KEY,
                         config.LLM_CRITIC_FALLBACK_MODEL, config.LLM_CRITIC_FALLBACK_JSON_MODE,
                         config.LLM_CRITIC_FALLBACK_REASONING_EFFORT, role="critic")
            )
        if not out:
            out = providers("primary")
            for p in out:
                p.role, p.role_note = "critic", "critic not configured: used primary"
        if model:
            for p in out:
                p.model = model
        return out
    out = []
    if config.llm_configured():
        out.append(Provider("primary", config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL, config.LLM_JSON_MODE, config.LLM_REASONING_EFFORT))
    if config.llm_fallback_configured():
        out.append(
            Provider(
                "fallback",
                config.LLM_FALLBACK_BASE_URL,
                config.LLM_FALLBACK_API_KEY,
                config.LLM_FALLBACK_MODEL,
                config.LLM_FALLBACK_JSON_MODE,
                config.LLM_FALLBACK_REASONING_EFFORT,
            )
        )
    if model:
        for p in out:
            p.model = model
    return out


def response_format(json_mode: str, schema: dict | None) -> dict | None:
    if json_mode == "json_object":
        return {"type": "json_object"}
    if json_mode == "json_schema" and schema:
        return {"type": "json_schema", "json_schema": {"name": "result", "schema": schema}}
    if json_mode == "json_schema":
        return {"type": "json_object"}
    return None  # "prompt": rely on the prompt; callers strip ``` fences


def _retryable(exc: Exception) -> bool:
    if isinstance(exc, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):
        return True
    return isinstance(exc, openai.APIStatusError) and exc.status_code >= 500


def call_provider(
    p: Provider,
    system: str,
    user: str,
    *,
    json: bool,
    schema: dict | None = None,
    json_mode: str | None = None,
    purpose: str = "agent",
    thread_id: str | None = None,
    sim_time: datetime | None = None,
    validate: Callable[[str], Any] | None = None,
    fallback_used: bool = False,
    emit: bool = True,
) -> tuple[str | None, dict[str, Any], Exception | None]:
    """One attempt on one provider. Returns (text or None, trace dict, exception or None)."""
    mode = (json_mode or p.json_mode) if json else None
    trace: dict[str, Any] = {
        "id": "llm_" + uuid.uuid4().hex[:12],
        "ts": datetime.now().isoformat(timespec="milliseconds"),
        "sim_time": sim_time.isoformat() if sim_time else None,
        "purpose": purpose,
        "thread_id": thread_id,
        "provider": p.name,
        "role": p.role,
        "role_note": p.role_note or None,
        "base_url": p.base_url,
        "model": p.model,
        "json_mode": mode,
        "system": system,
        "user": user,
        "raw_response": None,
        "parsed_ok": None,
        "parse_error": None,
        "latency_ms": None,
        "usage": {},
        "fallback_used": fallback_used,
        "error": None,
    }
    kwargs: dict[str, Any] = {}
    if mode and (rf := response_format(mode, schema)):
        kwargs["response_format"] = rf
    if p.reasoning_effort:
        kwargs["reasoning_effort"] = p.reasoning_effort
    t0 = time.perf_counter()
    text, exc = None, None
    try:
        client = OpenAI(base_url=p.base_url or None, api_key=p.api_key, timeout=config.LLM_TIMEOUT, max_retries=0)
        resp = client.chat.completions.create(
            model=p.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0,
            **kwargs,
        )
        text = resp.choices[0].message.content or ""
        trace["raw_response"] = text
        if resp.usage:
            u = resp.usage.model_dump()
            trace["usage"] = {
                "prompt_tokens": u.get("prompt_tokens"),
                "completion_tokens": u.get("completion_tokens"),
                "cost": u.get("cost"),  # Featherless returns usage.cost in USD
            }
        if validate:
            try:
                validate(text)
                trace["parsed_ok"] = True
            except Exception as e:  # noqa: BLE001 - recorded, the caller re-raises when it parses
                trace["parsed_ok"] = False
                trace["parse_error"] = str(e)[:2000]
    except Exception as e:  # noqa: BLE001
        exc = e
        trace["error"] = f"{type(e).__name__}: {e}"[:2000]
    trace["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    if emit:
        for sink in list(_sinks):
            try:
                sink(trace)
            except Exception:  # noqa: BLE001 - tracing must never break a call
                pass
    return text, trace, exc


def complete_traced(
    system: str,
    user: str,
    json_mode: bool = False,
    *,
    schema: dict | None = None,
    purpose: str = "agent",
    thread_id: str | None = None,
    sim_time: datetime | None = None,
    validate: Callable[[str], Any] | None = None,
    role: Role = "primary",
    model: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Call the primary provider, then the fallback on a retryable error.

    Returns (text, traces of every attempt). Raises the last error if every provider failed.
    `validate(text)` should raise on bad output. An answer that fails it is retried once on the same provider with
    the error appended, then the next provider is tried. If no provider gives a valid answer, the last answer is
    returned as it is (the caller's parse raises, as before).
    """
    chain = providers(role, model)
    if not chain:
        raise RuntimeError("LLM not configured: set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env")
    traces: list[dict[str, Any]] = []
    last: Exception | None = None
    invalid: str | None = None  # the latest answer that failed validation
    for i, p in enumerate(chain):
        prompt = user
        for _ in range(2):  # the answer, then one repair on a validation error
            text, trace, exc = call_provider(
                p,
                system,
                prompt,
                json=json_mode,
                schema=schema,
                purpose=purpose,
                thread_id=thread_id,
                sim_time=sim_time,
                validate=validate,
                fallback_used=i > 0,
            )
            traces.append(trace)
            if exc is not None:
                break
            error = _invalid(validate, text or "")
            if error is None:
                return text or "", traces
            invalid = text or ""
            prompt = (
                f"{user}\n\nYour previous answer could not be used: {error[:500]}\n"
                "Answer again with the complete, valid JSON only."
            )
        if exc is not None:
            last = exc
            if not _retryable(exc):
                break
    if invalid is not None:
        return invalid, traces
    assert last is not None
    raise last


def _invalid(validate: Callable[[str], Any] | None, text: str) -> str | None:
    """The validation error of an answer, or None when it is valid (or nothing validates it)."""
    if validate is None:
        return None
    try:
        validate(text)
        return None
    except Exception as e:  # noqa: BLE001 - any parse or schema error
        return f"{type(e).__name__}: {e}"


def complete(system: str, user: str, json_mode: bool = False, **kwargs: Any) -> str:
    """Same as before for existing callers; extra keyword arguments go to complete_traced."""
    text, _ = complete_traced(system, user, json_mode, **kwargs)
    return text
