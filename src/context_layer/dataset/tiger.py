"""Tiger Data (PostgreSQL + TimescaleDB) as the time-series view of the conversations.

One row per message in a hypertable partitioned by `sent_at`: answers "how much, when and by whom is this element
discussed?". Needs TIGER_DATABASE_URL in .env. Loaded with COPY, in batches, from the JSONL shards.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .. import config
from .source import load_alias_map, message_rows

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    thread_id text NOT NULL,
    seq integer NOT NULL,
    sent_at timestamptz NOT NULL,
    source text NOT NULL,
    author_id text NOT NULL,
    author text NOT NULL,
    role text,
    text text NOT NULL,
    mentions text[] NOT NULL DEFAULT '{}'
);
"""
HYPERTABLE = "SELECT create_hypertable('messages', 'sent_at', chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);"
INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS messages_pk ON messages (thread_id, seq, sent_at);",
    "CREATE INDEX IF NOT EXISTS messages_mentions ON messages USING GIN (mentions);",
    "CREATE INDEX IF NOT EXISTS messages_author ON messages (author_id, sent_at DESC);",
]
COLUMNS = "thread_id, seq, sent_at, source, author_id, author, role, text, mentions"
ACTIVITY = """
SELECT time_bucket(%s::interval, sent_at) AS bucket, count(*) AS messages, count(DISTINCT author_id) AS people
FROM messages WHERE mentions @> ARRAY[%s] GROUP BY 1 ORDER BY 1
"""
ACTIVITY_PLAIN = """
SELECT date_trunc('{unit}', sent_at) AS bucket, count(*) AS messages, count(DISTINCT author_id) AS people
FROM messages WHERE mentions @> ARRAY[%s] GROUP BY 1 ORDER BY 1
"""


def connect():
    import psycopg

    if not config.tiger_configured():
        raise SystemExit("TIGER_DATABASE_URL is not set. Copy the line from .env.example into .env and fill it in (docs/dataset.md).")
    return psycopg.connect(config.TIGER_DATABASE_URL, connect_timeout=15)


def has_timescale(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb';")
        return cur.fetchone() is not None


def setup(conn) -> str:
    """Create the table. Returns "hypertable" on a Time-series and analytics service, "plain" on a PostgreSQL service
    (same table, a BRIN index on the date instead of time partitioning: slower for big ranges, same answers)."""
    import psycopg

    try:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
        conn.commit()
    except psycopg.Error:  # a plain PostgreSQL service does not offer it
        conn.rollback()
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()
    mode = "plain"
    try:
        with conn.cursor() as cur:
            cur.execute(HYPERTABLE)
        conn.commit()
        mode = "hypertable"
    except psycopg.Error:  # FeatureNotSupported / UndefinedFunction: not a time-series service
        conn.rollback()
    with conn.cursor() as cur:
        for stmt in INDEXES:
            cur.execute(stmt)
        if mode == "plain":
            cur.execute("CREATE INDEX IF NOT EXISTS messages_sent_at ON messages USING BRIN (sent_at);")
    conn.commit()
    return mode


def check(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT version();")
        version = cur.fetchone()[0]
        cur.execute("SELECT to_regclass('messages') IS NOT NULL;")
        has_table = cur.fetchone()[0]
        out = {"server": version, "timescaledb": has_timescale(conn), "messages_table": has_table}
        if has_table:
            size_fn = "hypertable_size" if out["timescaledb"] else "pg_total_relation_size"
            try:
                cur.execute(f"SELECT count(*), pg_size_pretty({size_fn}('messages')) FROM messages;")
            except Exception:  # noqa: BLE001 - a plain table on a service that has the extension
                conn.rollback()
                cur.execute("SELECT count(*), pg_size_pretty(pg_total_relation_size('messages')) FROM messages;")
            n, size = cur.fetchone()
            out |= {"messages": n, "size": size}
    return out


def load(root: Path, conn, log=print, batch_threads: int = 5000) -> int:
    """Stream the shards into `messages` with COPY. Re-running adds duplicates only if you did not truncate: use --drop."""
    alias_map = load_alias_map(root)
    started, total = time.time(), 0
    for shard in sorted((root / "conversations").glob("threads-*.jsonl")):
        with open(shard, encoding="utf-8") as f:
            for lines in chunks(f, batch_threads):
                # One COPY per batch, committed after it ends: committing inside a running COPY hangs the connection.
                with conn.cursor() as cur, cur.copy(f"COPY messages ({COLUMNS}) FROM STDIN") as copy:
                    for line in lines:
                        for row in message_rows(json.loads(line), alias_map):
                            copy.write_row(row)
                            total += 1
                conn.commit()
                log(f"  messages: {total:,} ({shard.name}, {time.time() - started:.0f} s)")
    return total


def chunks(items, size: int):
    """Lists of at most `size` items, read lazily."""
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


# Analytics layer, safe to run again: compression of old chunks, a flat element-per-message hypertable and a
# continuous aggregate (messages per element per day). Needs a Time-series and analytics service.
ANALYTICS = [
    "ALTER TABLE messages SET (timescaledb.compress, timescaledb.compress_segmentby = 'source', timescaledb.compress_orderby = 'sent_at DESC');",
    "SELECT add_compression_policy('messages', INTERVAL '30 days', if_not_exists => TRUE);",
    "CREATE TABLE IF NOT EXISTS message_mentions (sent_at timestamptz NOT NULL, thread_id text, author_id text, element text NOT NULL);",
    "SELECT create_hypertable('message_mentions', 'sent_at', if_not_exists => TRUE);",
    "TRUNCATE message_mentions;",
    "INSERT INTO message_mentions SELECT sent_at, thread_id, author_id, unnest(mentions) FROM messages;",
    "CREATE MATERIALIZED VIEW IF NOT EXISTS daily_mentions WITH (timescaledb.continuous) AS "
    "SELECT time_bucket('1 day', sent_at) AS day, element, count(*) AS messages FROM message_mentions GROUP BY 1, 2 WITH NO DATA;",
]
FRESHNESS = "SELECT max(day) AS last_discussed, sum(messages)::bigint AS total, count(*) AS active_days FROM daily_mentions WHERE element = %s"


def analytics(conn, log=print) -> None:
    """Build or rebuild the analytics layer from the current `messages`."""
    if not has_timescale(conn):
        raise SystemExit("The analytics layer needs a Time-series and analytics service (TimescaleDB). See docs/dataset.md.")
    for stmt in ANALYTICS:
        with conn.cursor() as cur:
            cur.execute(stmt)
        conn.commit()
    conn.autocommit = True  # refresh_continuous_aggregate cannot run inside a transaction block
    try:
        with conn.cursor() as cur:
            cur.execute("CALL refresh_continuous_aggregate('daily_mentions', NULL, NULL);")
    finally:
        conn.autocommit = False
    log("analytics layer ready: messages compressed after 30 days, message_mentions, daily_mentions")


def verify(conn, expected_messages: int | None = None) -> list[tuple[str, str, str]]:
    """Checklist of what the project needs from Tiger Data: [(status, check, detail)], status "ok", "FAIL" or "n/a".

    Each check runs on its own so one missing view or table does not hide the others."""

    def one(sql: str, *params):
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    checks: list[tuple[str, str, str]] = []

    def run(name: str, fn) -> None:
        try:
            status, detail = fn()
        except Exception as e:  # noqa: BLE001 - report it, keep checking
            conn.rollback()
            status, detail = "FAIL", f"{type(e).__name__}: {str(e).splitlines()[0][:120]}"
        checks.append((status, name, detail))

    run("connection", lambda: ("ok", one("SELECT version();")[0].split(",")[0]))
    run("TimescaleDB extension (Time-series service)", lambda: ("ok", "installed") if has_timescale(conn) else ("FAIL", "plain PostgreSQL: create a Time-series and analytics service"))
    run("messages is a hypertable", lambda: ("ok", "partitioned by sent_at") if one("SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'messages'") else ("FAIL", "plain table: run load-tiger --drop on a time-series service"))

    def rows():
        n = one("SELECT count(*) FROM messages")[0]
        if expected_messages is None:
            return ("ok" if n else "FAIL", f"{n:,} rows (pass a dataset folder to compare with the manifest)")
        return ("ok", f"{n:,} rows") if n == expected_messages else ("FAIL", f"{n:,} rows, the dataset has {expected_messages:,} messages: reload with --drop")

    run("messages row count", rows)
    run("elements named per message (average)", lambda: ("ok", f"{one('SELECT round(avg(cardinality(mentions))::numeric, 2) FROM messages')[0]} per message"))
    run("indexes (pk, mentions GIN, author)", lambda: ("ok", "all 3") if one("SELECT count(*) FROM pg_indexes WHERE tablename = 'messages' AND indexname IN ('messages_pk', 'messages_mentions', 'messages_author')")[0] == 3 else ("FAIL", "missing: re-run load-tiger"))
    run("compression enabled", lambda: ("ok", "on") if one("SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = 'messages'")[0] else ("FAIL", "run tiger-analytics"))
    run("compression policy (30 days)", lambda: ("ok", "scheduled") if one("SELECT 1 FROM timescaledb_information.jobs WHERE proc_name = 'policy_compression' AND hypertable_name = 'messages'") else ("FAIL", "run tiger-analytics"))
    run("message_mentions filled", lambda: ("ok", f"{one('SELECT count(*) FROM message_mentions')[0]:,} rows") if one("SELECT count(*) FROM message_mentions")[0] else ("FAIL", "run tiger-analytics"))
    run("continuous aggregate daily_mentions", lambda: ("ok", f"{one('SELECT count(*) FROM daily_mentions')[0]:,} rows") if one("SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = 'daily_mentions'") else ("FAIL", "run tiger-analytics"))
    run("query: activity of the busiest element", lambda: ("ok", "answers") if activity(conn, one("SELECT element FROM message_mentions GROUP BY 1 ORDER BY count(*) DESC LIMIT 1")[0]) else ("FAIL", "no result"))
    return checks


def freshness(conn, element: str) -> tuple:
    """(last day humans talked about the element, total messages, number of active days)."""
    with conn.cursor() as cur:
        cur.execute(FRESHNESS, (element,))
        return cur.fetchone()


def activity(conn, element: str, bucket: str = "1 month") -> list[tuple]:
    """Messages and distinct people per time bucket that name the element."""
    with conn.cursor() as cur:
        if has_timescale(conn):
            cur.execute(ACTIVITY, (bucket, element))
        else:  # plain PostgreSQL: date_trunc takes a unit (day, week, month), not an interval
            unit = bucket.split()[-1].rstrip("s")
            if unit not in ("hour", "day", "week", "month", "year"):
                raise SystemExit(f"Unsupported bucket '{bucket}': use e.g. '1 day', '1 week' or '1 month'.")
            cur.execute(ACTIVITY_PLAIN.format(unit=unit), (element,))
        return cur.fetchall()
