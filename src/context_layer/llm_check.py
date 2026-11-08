"""`ctx llm-check`: which configured provider works, and with which JSON mode, on Elisa's chat."""

from __future__ import annotations

import json
from typing import Any

from . import config, llm
from .listen import load_teams
from .understand import LLMExtractor

MODES = ["json_object", "json_schema", "prompt"]


def check_provider(p: llm.Provider, thread_text: str, extractor: LLMExtractor) -> dict[str, Any]:
    result: dict[str, Any] = {"provider": p.name, "base_url": p.base_url, "model": p.model, "ping_ok": False, "modes": {}}
    _, trace, exc = llm.call_provider(p, "Reply with the single word: pong", "ping", json=False, purpose="check")
    result["ping_ok"] = exc is None
    result["ping_error"] = trace["error"]
    if exc is not None:
        result["recommended_mode"] = None
        return result
    for mode in MODES:
        text, trace, exc = llm.call_provider(
            p,
            extractor.system,
            thread_text,
            json=True,
            json_mode=mode,
            schema=extractor.schema,
            purpose="check",
            thread_id="elisa/teams_chat.json",
            validate=extractor.parse,
        )
        items = None
        if exc is None and trace["parsed_ok"]:
            items = len(extractor.parse(text or "").items)
        result["modes"][mode] = {
            "ok": exc is None and bool(trace["parsed_ok"]) and bool(items),
            "latency_ms": trace["latency_ms"],
            "error": trace["error"] or trace["parse_error"],
            "items": items,
        }
    result["recommended_mode"] = next((m for m in MODES if result["modes"][m]["ok"]), None)
    return result


def run_check() -> list[dict[str, Any]]:
    """Blocking; each provider is tried with every JSON mode. Calls are traced like any other."""
    chain = llm.providers()
    if not chain:
        return []
    thread = load_teams(config.DATA_DIR / "elisa" / "teams_chat.json", config.DATA_DIR)
    extractor = LLMExtractor()
    user = f"Known topics (reuse one for the same knowledge): none\n\n{thread.render()}"
    return [check_provider(p, user, extractor) for p in chain]


def print_report(results: list[dict[str, Any]]) -> None:
    if not results:
        print("No LLM configured. Set LLM_API_KEY (or GOOGLE_APPLICATION_CREDENTIALS) and LLM_MODEL in .env (see .env.example).")
        return
    for r in results:
        print(f"\n[{r['provider']}] {r['model']} @ {r['base_url']}")
        print(f"  ping: {'ok' if r['ping_ok'] else 'FAILED: ' + str(r.get('ping_error'))}")
        for mode, m in r["modes"].items():
            status = f"ok, {m['items']} item(s)" if m["ok"] else f"no ({m['error'] or 'no item extracted'})"
            print(f"  {mode:<12} {m['latency_ms']:>6} ms  {status}")
        rec = r.get("recommended_mode")
        var = "LLM_JSON_MODE" if r["provider"] == "primary" else "LLM_FALLBACK_JSON_MODE"
        print(f"  -> {var}={rec}" if rec else "  -> no working mode: check the model name and the key")
    print()


def main() -> None:
    llm.add_trace_sink(llm.jsonl_sink(config.WORKBENCH_LLM_CALLS_FILE))
    results = run_check()
    print_report(results)
    out = config.WORKBENCH_LLM_CALLS_FILE.parent / "llm_check.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Saved to {out} (every call is also in {config.WORKBENCH_LLM_CALLS_FILE.name})")
