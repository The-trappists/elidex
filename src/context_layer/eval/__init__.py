"""Accuracy evaluation: exchange (extraction) accuracy and retrieval accuracy. See docs/evaluation.md."""

from __future__ import annotations

from datetime import datetime

from .extraction import score_extraction
from .kb import ExtractorMode, build_kb, load_spec
from .outcomes import score_outcomes
from .retrieval import score_missing_observations, score_retrieval


def run_eval(mode: ExtractorMode = "scripted") -> dict:
    spec = load_spec()
    kb = build_kb(spec, mode)
    extraction = score_extraction(kb)
    plain = score_retrieval(kb, spec, extraction.label_of, use_conditions=False)
    cond = score_retrieval(kb, spec, extraction.label_of, use_conditions=True)
    return {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "extractor": mode,
        "knowledge_base": {"threads": len(kb.runs), "assertions": len(kb.store.assertions)},
        "extraction": {"summary": extraction.summary(), "threads": [vars(t) for t in extraction.threads]},
        "retrieval": [
            {"summary": r.summary(), "cases": [vars(c) | {"correct": c.correct} for c in r.cases]} for r in (plain, cond)
        ],
        "missing_observations": score_missing_observations(kb, spec, extraction.label_of),
        "field_feedback": score_outcomes(kb, spec, extraction.label_of),  # last: it records outcomes on the store
    }


def _pct(v) -> str:
    return "n/a" if v is None else f"{v * 100:.0f}%"


def render(result: dict) -> str:
    """Markdown report."""
    ex = result["extraction"]["summary"]
    lines = [
        f"# Accuracy report ({result['extractor']} extractor, {result['run_at']})",
        "",
        f"Knowledge base: {result['knowledge_base']['threads']} labelled conversations -> "
        f"{result['knowledge_base']['assertions']} assertions.",
        "",
        "## Retrieval: a problem happens, does the agent get the right solution?",
        "",
        "| Mode | Accuracy | Solution found | Clean answers | Correct silence | Precision | Recall | Noise items |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in result["retrieval"]:
        s = r["summary"]
        lines.append(f"| {s['mode']} | **{_pct(s['accuracy'])}** | {_pct(s['solution_found'])} | {_pct(s['clean_answers'])} | "
                     f"{_pct(s['correct_silence'])} | {_pct(s['precision'])} | {_pct(s['recall'])} | {s['noise_items']} |")
    lines += ["", "Cases answered wrongly (with conditions):", ""]
    wrong = [c for c in result["retrieval"][1]["cases"] if not c["correct"]]
    for c in wrong:
        bits = [f"missed {', '.join(c['missed'])}" if c["missed"] else "", f"noise {', '.join(c['noise'])}" if c["noise"] else ""]
        lines.append(f"- `{c['id']}` ({c['entity_id']}): " + "; ".join(b for b in bits if b))
    if not wrong:
        lines.append("- none")
    mo = result["missing_observations"]
    lines += [
        "",
        "## Edge cases: the agent knows less (every subset of each case's observations)",
        "",
        "| Observations missing | Runs | Accuracy | Solution lost |",
        "| --- | --- | --- | --- |",
        *(f"| {r['missing']} | {r['runs']} | {_pct(r['accuracy'])} | {r['solution_lost']} |" for r in mo["by_missing"]),
        "",
        "| Check status shown to the agent | Items | Precision | Noise |",
        "| --- | --- | --- | --- |",
        *(f"| {r['status']} | {r['items']} | {_pct(r['precision'])} | {r['noise']} |" for r in mo["by_status"]),
    ]
    ff = result["field_feedback"]
    lines += [
        "",
        "## Field feedback: knowledge that does not work in reality",
        "",
        f"Judgment right: **{_pct(ff['judgment_right'])}** of {len(ff['outcomes'])} labelled outcomes. "
        f"Contested flag right: **{_pct(ff['contested_right'])}** of cases, false alarms: {ff['false_alarms']}.",
        "",
        "| Outcome | Expected worked | Judged |",
        "| --- | --- | --- |",
        *(f"| `{o['id']}` | {o['expected']} | {o['got']} |" for o in ff["outcomes"]),
        "",
        *(f"- `{c['id']}`: contested {c['got'] or 'none'} (expected {c['expected'] or 'none'})" for c in ff["contested_cases"]),
    ]
    lines += [
        "",
        "## Exchange: did we keep the right information from each conversation?",
        "",
        "| Item recall | Item precision | Message precision | Message recall | Binding exact | Trust right | Noise threads left empty |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        f"| {_pct(ex['item_recall'])} | {_pct(ex['item_precision'])} | {_pct(ex['message_precision'])} | "
        f"{_pct(ex['message_recall'])} | {_pct(ex['binding_exact'])} | {_pct(ex['trust_right'])} | {_pct(ex['noise_threads_left_empty'])} |",
    ]
    lines.append(f"\nAverage confidence: right items {ex['avg_confidence_right_items']}, "
                 f"invented items {ex['avg_confidence_invented_items']} (informative only if right > invented).")
    if result["extractor"] == "scripted":
        lines += ["", "_Scripted extractor = the labels themselves: extraction scores are 100% by construction. "
                      "Run `ctx eval --extractor llm` to measure the real extractor._"]
    issues = [t for t in result["extraction"]["threads"] if t["missed"] or t["invented"] or t["binding_diffs"]]
    if issues:
        lines += ["", "Conversations with extraction issues:", ""]
        for t in issues:
            bits = [f"missed {t['missed']}" if t["missed"] else "", f"invented {t['invented']}" if t["invented"] else "",
                    f"binding {t['binding_diffs']}" if t["binding_diffs"] else ""]
            lines.append(f"- `{t['scenario']}`: " + "; ".join(b for b in bits if b))
    return "\n".join(lines) + "\n"
