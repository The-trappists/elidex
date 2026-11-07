#!/usr/bin/env python
"""Compare extractor models on the workbench scenarios that have `expected` items.

Modes (default is --scripted, which is offline and free):
  --scripted  score the scenarios' own expected items and any cached extraction against expected
  --dry-run   print what --run would call, and the estimated number of calls
  --run       real LLM calls; needs --yes-spend-credits; writes out/eval/<timestamp>.md and .json

Candidates come from a JSON file (see scripts/eval_candidates.example.json). It names the environment
variable that holds each key; it never contains a key. See docs/evaluation.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from context_layer import config
from context_layer.evaluation import binding_set, link_precision, link_recall, match_items
from context_layer.link import Inventory, Linker
from context_layer.models import ExtractedItem, ExtractionResult, Message, Thread
from context_layer.workbench.contracts import Scenario

DEFAULT_CANDIDATES = Path(__file__).with_name("eval_candidates.example.json")

# Scenario id -> thread id of data/cache/extractions.json (the cache is keyed by thread path).
CACHE_ALIASES = {
    "elisa-trn042-chat": "elisa/teams_chat.json",
    "elisa-trn042-email": "elisa/email.txt",
    "barrier-key-kemijarvi": "synthetic/email_barrier_access.txt",
    "firmware-4-2-rollout": "synthetic/teams_firmware_rollout.json",
}

# extract(scenario, thread) -> (items, latency_ms, calls)
Extract = Callable[[Scenario, Thread], tuple[list[ExtractedItem], float, int]]


@dataclass
class Totals:
    name: str
    scenarios: int = 0
    matched: int = 0
    missed: int = 0
    unexpected: int = 0
    binding_diffs: int = 0
    tp: int = 0
    got: int = 0
    want: int = 0
    latency_ms: float = 0.0
    calls: int = 0
    errors: list[str] = field(default_factory=list)
    per_scenario: dict[str, dict] = field(default_factory=dict)

    @property
    def precision(self) -> float:
        return self.tp / self.got if self.got else (1.0 if not self.want else 0.0)

    @property
    def recall(self) -> float:
        return self.tp / self.want if self.want else 1.0

    @property
    def avg_latency_ms(self) -> float | None:
        return self.latency_ms / self.calls if self.calls else None

    def summary(self) -> dict:
        return {
            "name": self.name, "scenarios": self.scenarios, "matched": self.matched, "missed": self.missed,
            "unexpected": self.unexpected, "binding_diffs": self.binding_diffs,
            "link_precision": round(self.precision, 3), "link_recall": round(self.recall, 3),
            "avg_latency_ms": None if self.avg_latency_ms is None else round(self.avg_latency_ms),
            "calls": self.calls, "errors": self.errors, "per_scenario": self.per_scenario,
        }


# ---------------------------------------------------------------- setup


def load_context():
    """(scenarios with expected items, personas by id, inventory)."""
    from context_layer.workbench import seed

    data = seed.load_seed()
    inv = Inventory(list(data.elements), list(data.sites))
    scenarios = [s for s in data.scenarios if s.expected and s.expected.items]
    return scenarios, {p.id: p for p in data.personas}, inv


def scenario_thread(s: Scenario, personas: dict) -> Thread:
    start = datetime(2026, 1, 1, 9, 0)
    msgs, t = [], 0.0
    for i, m in enumerate(s.messages, 1):
        t += m.delay_s
        p = personas.get(m.persona)
        msgs.append(Message(
            thread_id=s.id, source=s.channel, seq=i, author=p.name if p else m.persona,
            role=p.role if p else None, sent_at=start + timedelta(seconds=t), text=m.text,
        ))
    return Thread(id=s.id, source=s.channel, subject=s.subject, messages=msgs)


# ---------------------------------------------------------------- scoring


def linked_bindings(items: list[ExtractedItem], thread: Thread, inv: Inventory) -> set:
    linker = Linker(inv)
    out = []
    for item in items:
        r = linker.link(item, thread)
        if r.assertion is not None:
            out.append(r.assertion)
    return binding_set(out)


def score(name: str, scenarios: list[Scenario], personas: dict, inv: Inventory, extract: Extract) -> Totals:
    """Run `extract` on every scenario and accumulate the metrics.

    An extractor that raises counts as all expected items missed for that scenario."""
    from context_layer.workbench.processor import _scope_key

    tot = Totals(name)
    for s in scenarios:
        thread = scenario_thread(s, personas)
        want_items = s.expected.items
        try:
            got_items, latency, calls = extract(s, thread)
        except Exception as e:  # noqa: BLE001 - a failing model must not stop the comparison
            tot.errors.append(f"{s.id}: {type(e).__name__}: {str(e)[:120]}")
            got_items, latency, calls = [], 0.0, 1
        m = match_items(got_items, want_items, lambda i: _scope_key(i, inv))
        got_b = linked_bindings(got_items, thread, inv)
        want_b = linked_bindings(want_items, thread, inv)
        tot.scenarios += 1
        tot.matched += len(m["matched"])
        tot.missed += len(m["missed"])
        tot.unexpected += len(m["unexpected"])
        tot.binding_diffs += len(m["binding_diffs"])
        tot.tp += len(got_b & want_b)
        tot.got += len(got_b)
        tot.want += len(want_b)
        tot.latency_ms += latency
        tot.calls += calls
        tot.per_scenario[s.id] = {**m, "link_precision": round(link_precision(got_b, want_b), 3),
                                  "link_recall": round(link_recall(got_b, want_b), 3)}
    return tot


# ---------------------------------------------------------------- extractors


def scripted_extract(s: Scenario, thread: Thread):
    return list(s.expected.items), 0.0, 0


def cache_extractor(cache: dict) -> tuple[Extract, set[str]]:
    """Extractor replaying data/cache/extractions.json, and the scenario ids it can answer."""
    ids = {sid for sid, tid in CACHE_ALIASES.items() if tid in cache}

    def extract(s: Scenario, thread: Thread):
        return ExtractionResult.model_validate(cache[CACHE_ALIASES[s.id]]).items, 0.0, 0

    return extract, ids


def load_candidates(path: Path) -> list[dict]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    cands = raw["candidates"] if isinstance(raw, dict) else raw
    for c in cands:
        for k in ("name", "base_url", "model", "api_key_env"):
            if not c.get(k):
                raise ValueError(f"candidate {c.get('name', '?')!r} lacks '{k}'")
        c.setdefault("json_mode", "json_object")
    return cands


def llm_extract(cand: dict) -> Extract:
    """Real extractor for one candidate. Reads the key from the environment variable it names."""
    from context_layer import llm
    from context_layer.understand import LLMExtractor

    key = os.environ.get(cand["api_key_env"], "")
    if not key:
        raise RuntimeError(f"environment variable {cand['api_key_env']} is not set")
    provider = llm.Provider("primary", cand["base_url"], key, cand["model"], cand["json_mode"])
    ex = LLMExtractor(cache_path=config.OUT_DIR / "eval" / "unused_cache.json")  # never written: we call parse() only

    def extract(s: Scenario, thread: Thread):
        user = f"Known topics (reuse one for the same knowledge): none\n\n{thread.render()}"
        text, trace, exc = llm.call_provider(
            provider, ex.system, user, json=True, schema=ex.schema, purpose="extract",
            thread_id=thread.id, validate=ex.parse, emit=False,
        )
        latency = float(trace.get("latency_ms") or 0)
        if text is None:
            raise exc or RuntimeError("no answer")
        return ex.parse(text).items, latency, 1

    return extract


# ---------------------------------------------------------------- output


def table(results: list[Totals]) -> str:
    out = "| candidate | scenarios | matched | missed | unexpected | binding_diffs | link precision | link recall | avg latency (ms) | calls |\n"
    out += "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n"
    for t in results:
        lat = "-" if t.avg_latency_ms is None else f"{t.avg_latency_ms:.0f}"
        out += (f"| {t.name} | {t.scenarios} | {t.matched} | {t.missed} | {t.unexpected} | {t.binding_diffs} "
                f"| {t.precision:.2f} | {t.recall:.2f} | {lat} | {t.calls} |\n")
    for t in results:
        if t.errors:
            out += f"\nErrors for {t.name}:\n" + "".join(f"- {e}\n" for e in t.errors)
    return out


def run_scripted(scenarios, personas, inv, cache_path: Path) -> list[Totals]:
    results = [score("scripted (expected items)", scenarios, personas, inv, scripted_extract)]
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    extract, ids = cache_extractor(cache)
    if ids:
        sub = [s for s in scenarios if s.id in ids]
        results.append(score(f"cache ({len(sub)} scenarios)", sub, personas, inv, extract))
    return results


def dry_run_report(scenarios, cands: list[dict]) -> str:
    n = len(scenarios)
    lines = [f"Dry run: nothing is called. {n} scenarios have expected items.", ""]
    for c in cands:
        state = "set" if os.environ.get(c["api_key_env"]) else "NOT set"
        lines.append(f"- {c['name']}: {c['model']} at {c['base_url']} (json_mode={c['json_mode']}), "
                     f"key variable {c['api_key_env']} is {state}, {n} calls")
    lines += ["", f"Estimated total: {n * len(cands)} calls for {len(cands)} candidate(s). Run with --run --yes-spend-credits."]
    return "\n".join(lines)


def main(argv: list[str] | None = None, out_dir: Path | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--scripted", action="store_true", help="offline metric check (default)")
    mode.add_argument("--dry-run", action="store_true", help="show the calls --run would make")
    mode.add_argument("--run", action="store_true", help="real LLM calls")
    ap.add_argument("--yes-spend-credits", action="store_true", help="required with --run")
    ap.add_argument("--candidates", type=Path, default=DEFAULT_CANDIDATES)
    ap.add_argument("--cache", type=Path, default=config.CACHE_FILE)
    args = ap.parse_args(argv)

    if args.run and not args.yes_spend_credits:
        print("--run makes real LLM calls: add --yes-spend-credits to confirm.", file=sys.stderr)
        return 2

    scenarios, personas, inv = load_context()

    if args.dry_run:
        print(dry_run_report(scenarios, load_candidates(args.candidates)))
        return 0
    if args.run:
        results = []
        for c in load_candidates(args.candidates):
            try:
                extract = llm_extract(c)
            except RuntimeError as e:
                print(f"skipping {c['name']}: {e}", file=sys.stderr)
                continue
            results.append(score(c["name"], scenarios, personas, inv, extract))
    else:
        results = run_scripted(scenarios, personas, inv, args.cache)

    md = table(results)
    print(md)
    if args.run:
        out = out_dir or config.OUT_DIR / "eval"
        out.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        (out / f"{stamp}.md").write_text(md, encoding="utf-8")
        (out / f"{stamp}.json").write_text(json.dumps([r.summary() for r in results], indent=2), encoding="utf-8")
        print(f"written to {out / stamp}.md and .json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
