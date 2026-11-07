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


def cmd_dataset(args: argparse.Namespace) -> None:
    from pathlib import Path

    import time

    from .dataset import bench as ds_bench
    from .dataset import source as ds_source
    from .dataset.build import SCALES, generate

    if args.dataset_cmd == "generate":
        out = Path(args.out) if args.out else config.OUT_DIR / "dataset" / args.scale
        overrides = {k: v for k, v in (("sites", args.sites), ("staff", args.staff), ("facts", args.facts), ("threads", args.threads)) if v}
        generate(out, args.scale, seed=args.seed, workers=args.workers, overrides=overrides)
        print(f"Dataset written to {out}")
        return
    if args.dataset_cmd == "db-check":  # no dataset folder needed: only reports what the databases hold
        if config.mongo_configured():
            from .dataset import mongo

            print("MongoDB:", json.dumps(mongo.check(mongo.connect()), indent=2))
        else:
            print("MongoDB: MONGODB_URI not set")
        if config.tiger_configured():
            from .dataset import tiger

            with tiger.connect() as conn:
                print("Tiger Data:", json.dumps(tiger.check(conn), indent=2, default=str))
        else:
            print("Tiger Data: TIGER_DATABASE_URL not set")
        return
    if args.dataset_cmd == "mongo-indexes":  # after an interrupted load: data is there, only the indexes are missing
        import time as _t

        from .dataset import mongo

        db = mongo.connect()
        t0 = _t.time()
        mongo.create_indexes(db)
        for name in ("threads", "elements", "facts"):
            print(f"{name}: {sorted(i['name'] for i in db[name].list_indexes())}")
        print(f"indexes ready in {_t.time() - t0:.0f} s")
        return
    if args.dataset_cmd == "tiger-verify":
        from .dataset import tiger

        expected = None
        manifest = Path(args.path or config.DATASET_DIR) / "manifest.json"
        if manifest.exists():
            expected = json.loads(manifest.read_text(encoding="utf-8"))["conversations"]["messages"]
        with tiger.connect() as conn:
            checks = tiger.verify(conn, expected)
        for status, name, detail in checks:
            print(f"[{status:>4}] {name}: {detail}")
        sys.exit(1 if any(c[0] == "FAIL" for c in checks) else 0)
    if args.dataset_cmd in ("tiger-analytics", "freshness"):
        from .dataset import tiger

        with tiger.connect() as conn:
            if args.dataset_cmd == "tiger-analytics":
                tiger.analytics(conn)
            else:
                last, total, days = tiger.freshness(conn, args.element)
                print(f"{args.element}: last discussed {last}, {total or 0} messages over {days} active days")
        return
    if args.dataset_cmd == "activity":
        from .dataset import tiger

        with tiger.connect() as conn:
            for bucket, n, people in tiger.activity(conn, args.element, args.bucket):
                print(f"{bucket:%Y-%m-%d}  {n:>6} messages  {people:>4} people")
        return
    root = Path(args.path) if getattr(args, "path", None) else config.DATASET_DIR
    if args.dataset_cmd == "threads":
        from datetime import datetime as dt

        if args.source == "mongo":
            from .dataset import mongo

            src = ds_source.MongoSource(mongo.connect())
        else:
            src = ds_source.FileSource(root)
        t0 = time.perf_counter()
        shown = 0
        for t in src.threads(since=dt.fromisoformat(args.since) if args.since else None, until=dt.fromisoformat(args.until) if args.until else None, element=args.element, limit=args.limit):
            first = t["messages"][0]
            print(f"{t['id']}  {first['sent_at']}  {len(t['messages'])} msgs  {first['author']}: {first['text'][:90]!r}")
            shown += 1
        print(f"{shown} threads in {time.perf_counter() - t0:.2f} s ({args.source})")
        return
    if not (root / "manifest.json").exists():
        sys.exit(f"No dataset at {root}. Run `ctx dataset generate --scale {'|'.join(SCALES)}` first.")
    if args.dataset_cmd == "stats":
        print(json.dumps(ds_bench.read_manifest(root), indent=2, ensure_ascii=False))
    elif args.dataset_cmd == "load-mongo":
        from .dataset import mongo

        mongo.load(root, mongo.connect(), drop=args.drop, only=set(args.only) if args.only else None)
    elif args.dataset_cmd == "load-tiger":
        from .dataset import tiger

        with tiger.connect() as conn:
            print(f"Table mode: {tiger.setup(conn)}")
            if not args.drop:
                with conn.cursor() as cur:
                    cur.execute("SELECT count(*) FROM messages;")
                    held = cur.fetchone()[0]
                if held:
                    sys.exit(f"messages already holds {held:,} rows (another or the same dataset). Re-run with --drop to replace them.")
            if args.drop:
                with conn.cursor() as cur:
                    cur.execute("TRUNCATE messages;")
                conn.commit()
            n = tiger.load(root, conn)
            print(f"{n:,} messages loaded; {tiger.check(conn)}")
            if args.analytics:
                tiger.analytics(conn)
    else:
        print(json.dumps(ds_bench.bench(root, max_facts=args.facts, queries=args.queries), indent=2))


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

    ds = sub.add_parser("dataset", help="synthetic company dataset: network graph, staff, conversations, ground truth (docs/dataset.md)")
    dsub = ds.add_subparsers(dest="dataset_cmd", required=True)
    gen = dsub.add_parser("generate", help="write a dataset under out/dataset/<scale> (tiny, demo ~150 MB, large ~3 GB)")
    gen.add_argument("--scale", choices=["tiny", "demo", "large"], default="demo")
    gen.add_argument("--seed", type=int, default=42, help="same seed and scale = same files")
    gen.add_argument("--out", help="folder (default: out/dataset/<scale>)")
    gen.add_argument("--workers", type=int, help="processes for the conversations (default: min(8, cpus))")
    for name in ("sites", "staff", "facts", "threads"):
        gen.add_argument(f"--{name}", type=int, help=f"override the number of {name} of the scale")
    st = dsub.add_parser("stats", help="print the manifest of a dataset")
    st.add_argument("path", nargs="?")
    be = dsub.add_parser("bench", help="link and store the ground-truth facts, time lookups (scale check of the core)")
    be.add_argument("path", nargs="?")
    be.add_argument("--facts", type=int, help="only the first N facts")
    be.add_argument("--queries", type=int, default=500)
    lm = dsub.add_parser("load-mongo", help="stream a dataset into MongoDB Atlas (MONGODB_URI in .env), resumable")
    lm.add_argument("path", nargs="?", help="dataset folder (default: DATASET_DIR)")
    lm.add_argument("--drop", action="store_true", help="empty each collection first")
    lm.add_argument("--only", nargs="+", choices=["threads", "elements", "sites", "links", "users", "facts"], help="load only these collections")
    lt = dsub.add_parser("load-tiger", help="stream the messages into Tiger Data (TIGER_DATABASE_URL in .env)")
    lt.add_argument("path", nargs="?")
    lt.add_argument("--drop", action="store_true", help="truncate the messages table first (re-running without it fails on duplicates)")
    lt.add_argument("--analytics", action="store_true", help="then build the analytics layer (compression, daily_mentions); time-series service only")
    dsub.add_parser("mongo-indexes", help="(re)build the MongoDB indexes only, e.g. after an interrupted load-mongo")
    tv = dsub.add_parser("tiger-verify", help="checklist of what the project needs from Tiger Data (hypertable, row count, compression, aggregate)")
    tv.add_argument("path", nargs="?", help="dataset folder whose message count to compare with (default: DATASET_DIR)")
    dsub.add_parser("tiger-analytics", help="(re)build the Tiger Data analytics layer from the loaded messages")
    fr = dsub.add_parser("freshness", help="Tiger Data: when humans last talked about an element, from daily_mentions")
    fr.add_argument("element")
    dsub.add_parser("db-check", help="ping MongoDB and Tiger Data and show what they hold")
    th = dsub.add_parser("threads", help="list threads by time or element without loading the dataset")
    th.add_argument("--source", choices=["files", "mongo"], default="files")
    th.add_argument("--path", help="dataset folder for --source files (default: DATASET_DIR)")
    th.add_argument("--element", help="only threads naming this element id, e.g. TRN-042")
    th.add_argument("--since", help="ISO datetime")
    th.add_argument("--until", help="ISO datetime")
    th.add_argument("--limit", type=int, default=10)
    ac = dsub.add_parser("activity", help="Tiger Data: messages and people per month that name an element")
    ac.add_argument("element")
    ac.add_argument("--bucket", default="1 month")
    ds.set_defaults(func=cmd_dataset)

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
