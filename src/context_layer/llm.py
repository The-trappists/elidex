"""Thin wrapper over any OpenAI-compatible chat endpoint (Gemini, Featherless, Snowflake Cortex...).

- JSON mode per provider: "json_object", "json_schema" or "prompt" (LLM_JSON_MODE).
- Optional fallback provider on 429, 5xx, timeout or connection error (LLM_FALLBACK_*).
- Every attempt is traced as an LlmCall dict and handed to the registered sinks
  (the dashboard writes them to out/dashboard/llm_calls.jsonl). API keys are never traced.

Sinks run in the caller's thread: a sink that touches an asyncio loop must use call_soon_threadsafe.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

import openai
from openai import OpenAI

from . import config
from .connections import current_connection
from .demo_policy import current_policy

TraceSink = Callable[[dict[str, Any]], None]
_sinks: list[TraceSink] = []


def add_trace_sink(sink: TraceSink) -> None:
    _sinks.append(sink)


def remove_trace_sink(sink: TraceSink) -> None:
    if sink in _sinks:
        _sinks.remove(sink)


# Held by every JSONL append and by the dashboard log compaction, so a rewrite never loses a line.
FILE_LOCK = threading.Lock()


def jsonl_sink(path: Path) -> TraceSink:
    """A sink that appends each trace as one JSON line (thread-safe)."""
    lock = FILE_LOCK

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
    api_key: str = field(repr=False)
    model: str
    json_mode: str
    reasoning_effort: str = ""
    role: str = "primary"  # "primary" or "critic"
    role_note: str = ""  # e.g. "critic not configured: used primary"
    is_vertex: bool = False
    source: str = "server"  # "server" or "session" (a visitor's own key)


Role = Literal["primary", "critic"]


def _personal_provider(base_url: str, api_key: str, model: str, role: Role) -> Provider:
    """A visitor's own provider. It replaces every server role: no fallback, no critic key, no ADC."""
    name = "primary" if role == "primary" else "critic"
    effort = "low" if "generativelanguage.googleapis.com" in base_url else ""
    return Provider(
        name,
        base_url,
        api_key,
        model,
        "json_object",
        effort,
        role=role,
        role_note="personal AI connection" if role == "critic" else "",
        source="session",
    )


def active_model() -> str | None:
    """The model a new call would use: the workspace connection first, then the deployment."""
    registry = current_connection()
    if registry is not None and registry.ai is not None:
        return registry.ai.model
    return config.LLM_MODEL or None


def providers(role: Role = "primary", model: str | None = None) -> list[Provider]:
    """Provider chain for a role. An unconfigured critic falls back to the primary chain (noted in role_note)."""
    registry = current_connection()
    if registry is not None:
        if registry.ai is not None:
            return [_personal_provider(registry.ai.base_url, registry.ai.api_key,
                                       model or registry.ai.model, role)]
        if not registry.allow_server_ai:
            return []  # a public workspace that used a personal key never spends deployment keys
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
        if config.is_google_vertex_primary():
            from . import google_auth

            if config.LLM_BASE_URL and "aiplatform.googleapis.com" in config.LLM_BASE_URL:
                vertex_base_url = config.LLM_BASE_URL
            else:
                vertex_base_url = google_auth.get_vertex_base_url(
                    location=config.VERTEX_LOCATION,
                    cred_val=config.GOOGLE_APPLICATION_CREDENTIALS,
                    root_dir=config.ROOT,
                )
            effort = config._reasoning_effort("LLM_REASONING_EFFORT", vertex_base_url)
            out.append(
                Provider(
                    "primary",
                    vertex_base_url,
                    "",
                    config.LLM_MODEL,
                    config.LLM_JSON_MODE,
                    effort,
                    is_vertex=True,
                )
            )
        else:
            out.append(
                Provider(
                    "primary",
                    config.LLM_BASE_URL,
                    config.LLM_API_KEY,
                    config.LLM_MODEL,
                    config.LLM_JSON_MODE,
                    config.LLM_REASONING_EFFORT,
                )
            )
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


def _redact(text: str, provider: Provider) -> str:
    """Never let a personal key reach a trace, a log or an API response."""
    if provider.source == "session" and provider.api_key:
        return text.replace(provider.api_key, "[redacted]")
    return text


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
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),  # aware UTC
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
    reservation = None
    personal = p.source == "session"
    registry = current_connection()
    try:
        policy = current_policy()
        timeout = config.LLM_TIMEOUT
        if personal:
            if registry is None or registry.ai is None:
                from .demo_policy import DemoLimitError

                raise DemoLimitError("The personal AI connection is no longer available. Reconnect a provider.")
            if policy is not None:
                registry.reserve_personal_call(system, user)
                kwargs["max_tokens"] = min(1024, policy.max_output_tokens)
                timeout = min(timeout, 30.0)
        elif policy is not None:
            timeout = min(timeout, policy.reserve(system, user))
            kwargs["max_tokens"] = min(4096, policy.max_output_tokens)
            reservation = policy.reserve_budget(p.base_url, p.model, {
                "model": p.model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": 0,
                **kwargs,
            })
        if not personal and registry is not None and not registry.allow_server_ai:
            from .demo_policy import DemoLimitError

            raise DemoLimitError("Server AI is unavailable in this demo session. Connect your own provider.")
        from . import google_auth

        api_key = p.api_key
        model = p.model
        base_url = p.base_url

        if p.is_vertex or google_auth.is_vertex_endpoint(base_url):
            api_key = google_auth.get_google_access_token(
                cred_val=config.GOOGLE_APPLICATION_CREDENTIALS,
                root_dir=config.ROOT,
            )
            model = google_auth.format_vertex_model(model)

        if not personal and policy is not None:
            # Authentication may have taken time, or the workspace may have expired.
            # The reserved final call remains valid even when it reaches max_calls.
            if not policy.active or time.monotonic() >= policy.deadline:
                from .demo_policy import DemoLimitError

                raise DemoLimitError("The live demo run has ended.")
            timeout = min(timeout, max(0.001, policy.deadline - time.monotonic()))
        client = OpenAI(base_url=base_url or None, api_key=api_key, timeout=timeout, max_retries=0)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0,
            **kwargs,
        )
        text = resp.choices[0].message.content or ""
        if personal:
            text = _redact(text, p)
        trace["raw_response"] = text
        if resp.usage:
            u = resp.usage.model_dump()
            trace["usage"] = {
                "prompt_tokens": u.get("prompt_tokens"),
                "completion_tokens": u.get("completion_tokens"),
                "cost": u.get("cost"),  # Featherless returns usage.cost in USD
            }
            if policy is not None:
                policy.settle_budget(reservation, trace["usage"])
        if validate:
            try:
                validate(text)
                trace["parsed_ok"] = True
            except Exception as e:  # noqa: BLE001 - recorded, the caller re-raises when it parses
                trace["parsed_ok"] = False
                trace["parse_error"] = _redact(str(e), p)[:2000]
    except Exception as e:  # noqa: BLE001
        exc = e
        trace["error"] = _redact(f"{type(e).__name__}: {e}", p)[:2000]
    trace["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    if emit:
        policy = current_policy()
        sinks = ([policy.trace_sink] if policy.trace_sink else []) if policy is not None else list(_sinks)
        for sink in sinks:
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
    policy = current_policy()
    registry = current_connection()
    personal = registry is not None and registry.ai is not None
    if policy is not None and not personal:
        policy.require_active()
    chain = providers(role, model)
    if not chain:
        if registry is not None and not registry.allow_server_ai:
            raise RuntimeError("No personal AI provider is connected. Connect one in Connections.")
        raise RuntimeError("LLM not configured: set LLM_API_KEY (or GOOGLE_APPLICATION_CREDENTIALS) and LLM_MODEL in .env")
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
