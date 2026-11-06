"""Command line: `ctx run`, `ctx context`, `ctx agent`, `ctx serve`, `ctx mcp`, `ctx workbench`, `ctx llm-check`."""

import argparse
import json
import logging
import sys
from datetime import datetime

from . import config
from .link import Inventory
from .store import ContextStore


def load_store() -> ContextStore:
    if not config.STORE_FILE.exists():
        sys.exit(f"No store at {config.STORE_FILE}. Run `ctx run` first.")
    return ContextStore.load(config.STORE_FILE, Inventory.load())


def cmd_run(args: argparse.Namespace) -> None:
    from .pipeline import build_store

    store, report = build_store(use_llm=args.llm, lifecycle=args.lifecycle)
    store.save(config.STORE_FILE)
    print(f"Threads read: {len(report.threads)}")
    for t in report.threads:
        print(f"  - {t}")
    print(f"Items extracted: {report.extracted} · assertions stored: {report.stored} · merged: {report.merged}")
    for line in report.events:
        print(f"  event: {line}")
    for line in report.notes:
        print(f"  note:  {line}")
    print(f"Classes: {', '.join(store.classes) or 'none'}")
    print(f"Saved to {config.STORE_FILE.relative_to(config.ROOT)}")


def cmd_context(args: argparse.Namespace) -> None:
    from .agent import describe

    store = load_store()
    at = datetime.fromisoformat(args.at) if args.at else None
    hits = store.get_context(args.entity, at=at, include_expired=args.all)
    if args.json:
        print(json.dumps([{"via": h.matched_via, **h.assertion.model_dump(mode="json")} for h in hits], indent=2, ensure_ascii=False))
        return
    if not hits:
        print(f"No human context for {args.entity}.")
    for h in hits:
        print(describe(h) + "\n")


def cmd_agent(args: argparse.Namespace) -> None:
    from .agent import load_cases, run_agent

    store = load_store()
    cases = load_cases()
    if args.case:
        cases = [c for c in cases if c.id == args.case] or sys.exit(f"Unknown case {args.case}")
    for case in cases:
        r = run_agent(store, case, use_conditions=args.conditions, use_guard=args.guard, use_llm=args.llm)
        print("=" * 80)
        print(f"{case.id}: {case.title}\n  {case.entity_id} at {case.at:%Y-%m-%d %H:%M} · {case.description}")
        if case.observations:
            print(f"  observations: {case.observations}")
        print("-" * 80)
        print(r.recommendation)
        for hit, why in r.skipped:
            print(f"  (not applied: {hit.assertion.id}, {why})")
        if r.verdict:
            print(f"\nGuard on planned action '{r.verdict.action}': {r.verdict.decision.upper()}")
            for i, step in enumerate(r.verdict.steps, 1):
                print(f"  {i}. {step}")
            for reason in r.verdict.reasons:
                print(f"  why: {reason}")
    print("=" * 80)


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("context_layer.api:app", host=args.host, port=args.port, reload=False)


def cmd_workbench(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("context_layer.workbench.app:app", host=args.host, port=args.port, reload=args.reload)


def cmd_llm_check(_: argparse.Namespace) -> None:
    from .llm_check import main as check

    check()


def cmd_mcp(_: argparse.Namespace) -> None:
    from .mcp_server import mcp

    mcp.run()


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
    p = argparse.ArgumentParser(prog="ctx", description="Context layer: capture, link, store and reuse human knowledge.")
    sub = p.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="listen -> understand -> link -> store (writes out/context_store.json)")
    run.add_argument("--llm", action="store_true", help="call the LLM instead of replaying data/cache/")
    run.add_argument("--lifecycle", action="store_true", help="MVP D: later messages close validity, flag conflicts")
    run.set_defaults(func=cmd_run)

    ctx = sub.add_parser("context", help="what humans know about an entity")
    ctx.add_argument("entity", help="element or site ID, e.g. TRN-117")
    ctx.add_argument("--at", help="ISO datetime (default: now)")
    ctx.add_argument("--all", action="store_true", help="include expired assertions")
    ctx.add_argument("--json", action="store_true")
    ctx.set_defaults(func=cmd_context)

    ag = sub.add_parser("agent", help="run the demo agent on the synthetic cases")
    ag.add_argument("case", nargs="?", help="case id (default: all cases)")
    ag.add_argument("--conditions", action="store_true", help="MVP C: apply a rule only when its conditions hold")
    ag.add_argument("--guard", action="store_true", help="MVP B: check the planned action before acting")
    ag.add_argument("--llm", action="store_true", help="let the LLM phrase the plan")
    ag.set_defaults(func=cmd_agent)

    srv = sub.add_parser("serve", help="REST API (FastAPI)")
    srv.add_argument("--host", default="127.0.0.1")
    srv.add_argument("--port", type=int, default=8000)
    srv.set_defaults(func=cmd_serve)

    sub.add_parser("mcp", help="MCP server over stdio, for agents").set_defaults(func=cmd_mcp)

    wb = sub.add_parser("workbench", help="real-time test bench: API + web UI (docs/workbench.md)")
    wb.add_argument("--host", default="127.0.0.1")
    wb.add_argument("--port", type=int, default=8000)
    wb.add_argument("--reload", action="store_true", help="restart on code changes (dev)")
    wb.set_defaults(func=cmd_workbench)

    sub.add_parser("llm-check", help="test each configured LLM provider and JSON mode on Elisa's chat").set_defaults(
        func=cmd_llm_check
    )

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
