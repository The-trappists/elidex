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


def connect():
    import psycopg

    if not config.tiger_configured():
        raise SystemExit("TIGER_DATABASE_URL is not set. Copy the line from .env.example into .env and fill it in (docs/dataset.md).")
    return psycopg.connect(config.TIGER_DATABASE_URL, connect_timeout=15)


def setup(conn) -> None:
    with conn.cursor() as cur:
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb;")
        except Exception:  # noqa: BLE001 - already installed or not allowed: the next statement tells
            conn.rollback()
        cur.execute(SCHEMA)
        cur.execute(HYPERTABLE)
        for stmt in INDEXES:
            cur.execute(stmt)
    conn.commit()


def check(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT version();")
        version = cur.fetchone()[0]
        cur.execute("SELECT to_regclass('messages') IS NOT NULL;")
        has_table = cur.fetchone()[0]
        out = {"server": version, "messages_table": has_table}
        if has_table:
            cur.execute("SELECT count(*), pg_size_pretty(hypertable_size('messages')) FROM messages;")
            n, size = cur.fetchone()
            out |= {"messages": n, "size": size}
    return out


def load(root: Path, conn, log=print, batch_threads: int = 5000) -> int:
    """Stream the shards into `messages` with COPY. Re-running adds duplicates only if you did not truncate: use --drop."""
    alias_map = load_alias_map(root)
    started, total = time.time(), 0
    for shard in sorted((root / "conversations").glob("threads-*.jsonl")):
        with open(shard, encoding="utf-8") as f, conn.cursor() as cur:
            with cur.copy(f"COPY messages ({COLUMNS}) FROM STDIN") as copy:
                for i, line in enumerate(f, 1):
                    for row in message_rows(json.loads(line), alias_map):
                        copy.write_row(row)
                        total += 1
                    if i % batch_threads == 0:
                        conn.commit()
        conn.commit()
        log(f"  messages: {total:,} ({shard.name}, {time.time() - started:.0f} s)")
    return total


def activity(conn, element: str, bucket: str = "1 month") -> list[tuple]:
    """Messages and distinct people per time bucket that name the element."""
    with conn.cursor() as cur:
        cur.execute(ACTIVITY, (bucket, element))
        return cur.fetchall()
