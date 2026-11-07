"""Cold archive of what the endless company day prunes from memory (docs/workbench.md, "Cold archive").

Default: append-only JSONL files (`threads.jsonl`, `incidents.jsonl`, `jobs.jsonl`) under out/workbench/archive/.
Optional, only when configured and reachable:
- Atlas (`MONGODB_URI`): collections `wb_threads`, `wb_incidents`, `wb_jobs`;
- a Tiger Data time-series sink (`TIGER_DATABASE_URL`): table `wb_company_metrics`, one row per sync cycle.
Writes go through a queue to one background thread, so the company loop never waits. A cloud failure logs one warning,
disables that backend and the documents go to the files instead. Nothing here raises into the caller.
Knowledge (assertions, classes) is never archived away: it stays in memory and keeps its `SourceRef`s."""

from __future__ import annotations

import json
import logging
import queue
import secrets
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable

from .. import config

log = logging.getLogger(__name__)

KINDS = ("threads", "incidents", "jobs")
MAX_QUEUE = 5000
RECENT_THREADS = 300  # archived threads kept in memory so a lookup works before the queue is written
METRICS_TABLE = "wb_company_metrics"
# The only cloud objects clear() may ever touch. Hard-coded on purpose: never build these from input or config.
CLEARABLE_COLLECTIONS = ("wb_threads", "wb_incidents", "wb_jobs")
CLEARABLE_TABLE = "wb_company_metrics"
METRICS_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS {METRICS_TABLE} (
    sim_time timestamptz NOT NULL,
    cycle integer,
    knowledge_total integer,
    knowledge_valid integer,
    open_incidents integer,
    healthy integer, degraded integer, down integer, recovering integer,
    agent_calls integer
);
"""
METRICS_COLUMNS = ["sim_time", "cycle", "knowledge_total", "knowledge_valid", "open_incidents",
                   "healthy", "degraded", "down", "recovering", "agent_calls"]


def _atlas_default():
    from ..dataset import mongo

    return mongo.connect(timeout_ms=4000, socket_timeout_ms=5000)


def _tiger_default():
    from ..dataset import tiger

    return tiger.connect(timeout=4, statement_timeout_ms=5000)


class Archive:
    """`directory=None`: nothing is written to disk (tests, or an archive that is switched off)."""

    def __init__(
        self,
        directory: Path | None,
        atlas: Callable[[], Any] | None | bool = True,
        tiger: Callable[[], Any] | None | bool = True,
    ):
        """`atlas`/`tiger`: True = use the real connection when configured, a callable = a fake (tests), False = off."""
        self.dir = Path(directory) if directory else None
        self._atlas_factory = (
            (_atlas_default if config.mongo_configured() else None) if atlas is True else (atlas if callable(atlas) else None)
        )
        self._tiger_factory = (
            (_tiger_default if config.tiger_configured() else None) if tiger is True else (tiger if callable(tiger) else None)
        )
        self._atlas_db: Any = None
        self._tiger_conn: Any = None
        self._atlas_ok = self._atlas_factory is not None
        self._tiger_ok = self._tiger_factory is not None
        self._tiger_ready = False
        self._q: queue.Queue = queue.Queue(maxsize=MAX_QUEUE)
        self._worker: threading.Thread | None = None
        self._lock = threading.Lock()
        self._recent: OrderedDict[str, dict] = OrderedDict()
        self._counts = {k: 0 for k in KINDS}
        self._counts["metrics"] = 0
        self._counted_files = False
        self._dropped = 0
        self.session = secrets.token_hex(3)
        self._epoch = 0  # bumped by clear(): queued items of an older epoch are dropped by the worker
        self._io = threading.Lock()  # held by the worker while it writes and by clear() while it wipes

    # ------------------------------------------------------------ public

    @property
    def backend(self) -> str:
        cloud = [n for n, ok in (("atlas", self._atlas_ok), ("tiger-sink", self._tiger_ok)) if ok]
        return "+".join(cloud) if cloud else "files"

    def put(self, kind: str, doc: dict) -> None:
        """Queue one document (JSON-compatible dict with an `id`). Never blocks, never raises."""
        try:
            if kind != "threads":  # ids like inc_0001 restart after a reset: make them unique per process
                doc = {**doc, "original_id": doc["id"], "id": f"{self.session}/{doc['id']}"}
            if kind == "threads":
                with self._lock:
                    self._recent[doc["id"]] = doc
                    while len(self._recent) > RECENT_THREADS:
                        self._recent.popitem(last=False)
            self._enqueue((self._epoch, "doc", kind, doc))
        except Exception as e:  # noqa: BLE001
            log.warning("archive: could not queue a %s document (%s)", kind, e)

    def put_metrics(self, row: dict) -> None:
        """One row per sync cycle for the Tiger sink. Ignored when no sink is configured."""
        if self._tiger_ok:
            self._enqueue((self._epoch, "metrics", "metrics", row))

    def get_thread(self, thread_id: str) -> dict | None:
        """The archived thread (dict with messages) or None. Reads memory, then Atlas, then the file."""
        try:
            with self._lock:
                doc = self._recent.get(thread_id)
            if doc is not None:
                return doc
            if self._atlas_ok:
                try:
                    d = self._atlas()["wb_threads"].find_one({"_id": thread_id})
                    if d:
                        d.pop("_id", None)
                        return d
                except Exception as e:  # noqa: BLE001
                    self._atlas_failed(e)
            return self._scan_file("threads", thread_id)
        except Exception as e:  # noqa: BLE001
            log.warning("archive: get_thread failed (%s)", e)
            return None

    def stats(self) -> dict:
        self._count_files()
        return {
            "backend": self.backend,
            "files": self.dir is not None,
            "directory": str(self.dir) if self.dir else None,
            "counts": dict(self._counts),
            "queued": self._q.qsize(),
            "dropped": self._dropped,
            "atlas": {"configured": self._atlas_factory is not None, "active": self._atlas_ok},
            "tiger": {"configured": self._tiger_factory is not None, "active": self._tiger_ok},
        }

    def flush(self, timeout: float = 5.0) -> bool:
        """Wait until the queue is written (tests, shutdown)."""
        done = threading.Event()
        threading.Thread(target=lambda: (self._q.join(), done.set()), daemon=True).start()
        return done.wait(timeout)

    # ------------------------------------------------------------ clear

    def discard_pending(self) -> int:
        """First half of clear(), instant: queued writes and the in-memory thread cache are dropped from now on.
        Returns the new epoch (pass it to `clear`)."""
        with self._lock:
            self._epoch += 1
            self._recent.clear()
            return self._epoch

    def clear(self, epoch: int | None = None) -> dict:
        """Empty the archive: JSONL files, counters and, when configured, the three Atlas collections (delete_many({}),
        indexes survive) and the Tiger table (TRUNCATE, never DROP). Never raises, never puts a URI or credential in
        a message. Pass the epoch from `discard_pending()` when it was called earlier; writes queued after that
        point are kept and simply wait for the wipe to finish."""
        if epoch is None:
            epoch = self.discard_pending()
        result: dict = {"files_removed": 0, "atlas": "off", "tiger": "off"}
        with self._io:  # waits for the write in flight; the worker then drops stale items and holds new ones
            result["files_removed"] = self._clear_files()
            if self._atlas_factory is not None:
                result["atlas"] = self._clear_atlas()
            if self._tiger_factory is not None:
                result["tiger"] = self._clear_tiger()
        failed = [f"{k}: {v}" for k, v in result.items() if isinstance(v, str) and v.startswith("failed")]
        if failed:
            log.warning("archive: clear incomplete (%s); the files are cleared", "; ".join(failed))
        return result

    def _clear_files(self) -> int:
        removed = 0
        if self.dir is not None:
            for kind in KINDS:
                path = self.dir / f"{kind}.jsonl"
                try:
                    if path.exists():
                        path.unlink()
                        removed += 1
                except OSError as e:
                    log.warning("archive: could not remove %s (%s)", path.name, type(e).__name__)
        self._counts = {k: 0 for k in (*KINDS, "metrics")}
        self._counted_files = True  # nothing left to count
        self._dropped = 0
        return removed

    def _clear_atlas(self) -> dict | str:
        out: dict = {}
        try:
            db = self._atlas()
            for name in CLEARABLE_COLLECTIONS:
                assert name in ("wb_threads", "wb_incidents", "wb_jobs"), name
                out[name] = int(db[name].delete_many({}).deleted_count)
            return out
        except Exception as e:  # noqa: BLE001 - only the class name: messages can carry the URI
            self._atlas_db = None
            return f"failed: {type(e).__name__}"

    def _clear_tiger(self) -> str:
        try:
            assert CLEARABLE_TABLE == "wb_company_metrics"
            conn = self._tiger()
            with conn.cursor() as cur:
                cur.execute("SELECT to_regclass(%s)", (CLEARABLE_TABLE,))
                row = cur.fetchone()
                if row and row[0]:
                    cur.execute("TRUNCATE TABLE wb_company_metrics")
            conn.commit()
            return "truncated"
        except Exception as e:  # noqa: BLE001
            self._tiger_conn = None
            return f"failed: {type(e).__name__}"

    # ------------------------------------------------------------ worker

    def _enqueue(self, item: tuple) -> None:
        if self._worker is None:
            with self._lock:
                if self._worker is None:
                    self._count_files()
                    self._worker = threading.Thread(target=self._run, name="wb-archive", daemon=True)
                    self._worker.start()
        try:
            self._q.put_nowait(item)
        except queue.Full:
            self._dropped += 1
            if self._dropped == 1:
                log.warning("archive: queue full, documents are dropped")

    def _run(self) -> None:
        while True:
            epoch, what, kind, doc = self._q.get()
            try:
                with self._io:
                    if epoch != self._epoch:
                        continue  # queued before a clear(): must not land after it
                    if what == "metrics":
                        self._write_metrics(doc)
                    else:
                        self._write_doc(kind, doc)
            except Exception as e:  # noqa: BLE001 - the worker never dies
                log.warning("archive: write failed (%s: %s)", type(e).__name__, e)
            finally:
                self._q.task_done()

    def _write_doc(self, kind: str, doc: dict) -> None:
        self._counts[kind] += 1
        if self._atlas_ok:
            try:
                self._atlas()[f"wb_{kind}"].replace_one({"_id": doc["id"]}, {"_id": doc["id"], **doc}, upsert=True)
                return
            except Exception as e:  # noqa: BLE001
                self._atlas_failed(e)
        if self.dir is None:
            return
        self.dir.mkdir(parents=True, exist_ok=True)
        with (self.dir / f"{kind}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(doc, ensure_ascii=False, default=str) + "\n")

    def _write_metrics(self, row: dict) -> None:
        if not self._tiger_ok:
            return
        try:
            conn = self._tiger()
            if not self._tiger_ready:
                with conn.cursor() as cur:
                    cur.execute(METRICS_SCHEMA)
                    try:
                        cur.execute(f"SELECT create_hypertable('{METRICS_TABLE}', 'sim_time', if_not_exists => TRUE);")
                    except Exception:  # noqa: BLE001 - plain PostgreSQL: a normal table is fine
                        conn.rollback()
                        cur.execute(METRICS_SCHEMA)
                conn.commit()
                self._tiger_ready = True
            cols = ", ".join(METRICS_COLUMNS)
            marks = ", ".join(["%s"] * len(METRICS_COLUMNS))
            with conn.cursor() as cur:
                cur.execute(f"INSERT INTO {METRICS_TABLE} ({cols}) VALUES ({marks})", [row.get(c) for c in METRICS_COLUMNS])
            conn.commit()
            self._counts["metrics"] += 1
        except Exception as e:  # noqa: BLE001
            self._tiger_ok = False
            self._tiger_conn = None
            log.warning("archive: Tiger sink failed (%s: %s), metrics are no longer sent", type(e).__name__, e)

    def _atlas(self):
        if self._atlas_db is None:
            self._atlas_db = self._atlas_factory()
        return self._atlas_db

    def _tiger(self):
        if self._tiger_conn is None:
            self._tiger_conn = self._tiger_factory()
        return self._tiger_conn

    def _atlas_failed(self, e: Exception) -> None:
        if self._atlas_ok:
            log.warning("archive: Atlas failed (%s: %s), the JSONL files are used instead", type(e).__name__, e)
        self._atlas_ok = False
        self._atlas_db = None

    # ------------------------------------------------------------ files

    def _scan_file(self, kind: str, doc_id: str) -> dict | None:
        if self.dir is None:
            return None
        path = self.dir / f"{kind}.jsonl"
        if not path.exists():
            return None
        needle = json.dumps(doc_id, ensure_ascii=False)
        found = None
        with path.open(encoding="utf-8") as f:
            for line in f:
                if needle in line:
                    try:
                        d = json.loads(line)
                    except ValueError:
                        continue
                    if d.get("id") == doc_id:
                        found = d  # the last copy wins
        return found

    def _count_files(self) -> None:
        """Counts of what earlier runs wrote (added once, lazily)."""
        if self._counted_files or self.dir is None:
            return
        self._counted_files = True
        for kind in KINDS:
            path = self.dir / f"{kind}.jsonl"
            if path.exists():
                with path.open("rb") as f:
                    self._counts[kind] += sum(1 for _ in f)
