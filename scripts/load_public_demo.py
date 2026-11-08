"""Exercise private demo sessions without invoking the live-run endpoint.

Run against a staging server: python scripts/load_public_demo.py --users 10.
Only GET requests are issued. New visitor sessions consume server capacity.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
import json
import statistics
import time
import urllib.request


def visitor(base: str, rounds: int, stream_seconds: float) -> dict:
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    latencies = []
    transferred = 0
    for path in ["/api/demo"] + ["/api/state"] * rounds:
        started = time.monotonic()
        with client.open(base + path, timeout=60) as response:
            payload = response.read()
        latencies.append(time.monotonic() - started)
        transferred += len(payload)
        if path == "/api/demo" and not json.loads(payload).get("enabled"):
            raise RuntimeError("Target is not in public demo mode; stopping visitor")
    if stream_seconds:
        with client.open(base + "/api/stream", timeout=60) as response:
            if not response.readline():
                raise RuntimeError("Event stream closed before its first line")
            time.sleep(stream_seconds)
    return {"seconds": latencies, "bytes": transferred}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--stream-seconds", type=float, default=10, help="Hold each visitor's SSE connection open")
    args = parser.parse_args()
    if not 1 <= args.users <= 200 or not 1 <= args.rounds <= 100:
        parser.error("users must be 1–200 and rounds 1–100")
    if not 0 <= args.stream_seconds <= 300:
        parser.error("stream-seconds must be 0–300")
    started = time.monotonic()
    results, errors = [], []
    with ThreadPoolExecutor(max_workers=args.users) as pool:
        futures = [pool.submit(visitor, args.url.rstrip("/"), args.rounds, args.stream_seconds) for _ in range(args.users)]
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                errors.append(str(exc))
    durations = sorted(t for result in results for t in result["seconds"])
    report = {
        "users": args.users, "completed": len(results), "failed": len(errors),
        "elapsed_seconds": round(time.monotonic() - started, 3),
        "response_bytes": sum(result["bytes"] for result in results),
        "p50_seconds": round(statistics.median(durations), 3) if durations else None,
        "p95_seconds": round(durations[min(len(durations) - 1, int(len(durations) * .95))], 3) if durations else None,
        "errors": errors[:10],
    }
    print(json.dumps(report, indent=2))
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
