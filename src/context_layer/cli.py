"""Command line: `ctx run`, `ctx context`, `ctx agent`, `ctx graph`, `ctx serve`, `ctx mcp`, `ctx workbench`, `ctx llm-check`."""

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


def cmd_graph(args: argparse.Namespace) -> None:
    from .graph import KnowledgeGraph, to_cypher, to_cytoscape, to_node_link

    kg = KnowledgeGraph.build(load_store())
    at = datetime.fromisoformat(args.at) if getattr(args, "at", None) else None
    g = kg.snapshot(at) if at and args.graph_cmd == "export" else kg.g

    if args.graph_cmd == "stats":
        out = kg.stats()
    elif args.graph_cmd == "export":
        if args.format == "cypher":
            text = to_cypher(g)
        else:
            data = to_cytoscape(g) if args.format == "cytoscape" else to_node_link(g)
            text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"Wrote {args.out} ({g.number_of_nodes()} nodes, {g.number_of_edges()} edges)")
        else:
            sys.stdout.write(text)
        return
    elif args.graph_cmd == "push":
        from .graph.neo4j_sync import push

        if not config.NEO4J_PASSWORD or config.NEO4J_PASSWORD.startswith("your-"):
            sys.exit("Set NEO4J_PASSWORD in .env (see deploy/docker-compose.neo4j.yml).")
        out = push(g, config.NEO4J_URI, config.NEO4J_USER, config.NEO4J_PASSWORD, config.NEO4J_DATABASE, wipe=args.wipe)
    elif args.graph_cmd == "provenance":
        out = kg.provenance(args.assertion)
    elif args.graph_cmd == "reach":
        out = kg.reach(args.assertion)
    elif args.graph_cmd == "experts":
        out = kg.experts(args.entity, at=at)
    elif args.graph_cmd == "timeline":
        out = kg.timeline(args.entity, at=at)
    elif args.graph_cmd == "mentions":
        out = kg.mentions(args.entity)
    print(json.dumps(out, indent=2, ensure_ascii=False, default=str))


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

    gr = sub.add_parser("graph", help="knowledge graph: stats, export, Neo4j push, provenance, experts...")
    gsub = gr.add_subparsers(dest="graph_cmd", required=True)
    gsub.add_parser("stats", help="node and edge counts by type")
    ex = gsub.add_parser("export", help="write the graph as JSON, Cytoscape elements or a Cypher script")
    ex.add_argument("--format", choices=["json", "cytoscape", "cypher"], default="json")
    ex.add_argument("--at", help="ISO datetime: only assertions valid then")
    ex.add_argument("--out", help="file to write (default: stdout)")
    pu = gsub.add_parser("push", help="MERGE the graph into Neo4j (NEO4J_* in .env)")
    pu.add_argument("--wipe", action="store_true", help="delete our nodes in Neo4j first")
    for name, helptext in (("provenance", "messages an assertion came from"), ("reach", "elements an assertion reaches")):
        sp = gsub.add_parser(name, help=helptext)
        sp.add_argument("assertion", help="assertion id, e.g. ctx_0002")
    for name, helptext in (("experts", "who knows about an entity"), ("timeline", "an entity's knowledge over time"),
                           ("mentions", "raw messages naming an entity")):
        sp = gsub.add_parser(name, help=helptext)
        sp.add_argument("entity", nargs="?" if name == "experts" else None, help="element or site ID, e.g. TRN-117")
        sp.add_argument("--at", help="ISO datetime (default: now)")
    gr.set_defaults(func=cmd_graph)

    srv = sub.add_parser("serve", help="REST API (FastAPI)")
    srv.add_argument("--host", default="127.0.0.1")
    srv.add_argument("--port", type=int, default=8000)
    srv.set_defaults(func=cmd_serve)

    sub.add_parser("mcp", help="MCP server over stdio, for agents").set_defaults(func=cmd_mcp)

    wb = sub.add_parser("workbench", help="real-time test bench: API + web UI (docs/workbench.md)")
    wb.add_argument("--host", default="127.0.0.1")
    wb.add_argument("--port", type=int, default=8010)
    wb.add_argument("--reload", action="store_true", help="restart on code changes (dev)")
    wb.set_defaults(func=cmd_workbench)

    sub.add_parser("llm-check", help="test each configured LLM provider and JSON mode on Elisa's chat").set_defaults(
        func=cmd_llm_check
    )

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
