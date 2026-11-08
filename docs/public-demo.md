# Public visitor demo

The public demo gives each browser a private, cookie-bound workspace. The normal team dashboard remains available when `PUBLIC_DEMO` is unset. The public deployment replaces the team dashboard on the selected hostname; use a separate deployment if both must remain accessible.

The full marketing homepage stays at `/`, using the homepage from `main`. It does not allocate a workspace or depend on API availability. The visitor enters the private demo through its dashboard links; the workspace logo returns to the homepage.

The demo opens on a task-focused walkthrough, separate from the marketing homepage: read the original TRN-042 SFP conversation, inspect that conversation's captured workaround, then run a prepared TRN-117 case with observations and a planned reboot. Explicit next-step links preserve the walkthrough across screens. This path is scripted and does not consume the live allowance. Company simulation and the single live trial remain available for further exploration.

Each workspace starts with preloaded synthetic data. Scripted exploration does not call model APIs or connect to Slack. A visitor can spend one bounded live scenario allowance, then continue in scripted mode. This is a browser allowance, not a verified-person allowance: clearing cookies can create another workspace.

## Prepare and deploy (human operator)

Do not deploy until the implementation checks pass and the branch includes the existing dashboard rename work. This branch was created from a checkout containing other contributors' uncommitted changes; do not commit unrelated changes blindly.

On the VM, fetch and check out the published branch after saving any local edits. Keep the existing model configuration in your private `.env`; agents must not read it. Set `DOMAIN=209.250.242.163.sslip.io`. The base Compose file still requires `BASIC_AUTH_USER` and `BASIC_AUTH_HASH`, but the public Caddy configuration does not use them.

All commands run from the repository root. Build the image:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.public-demo.yml --env-file .env build app
```

Prepare a snapshot once. This command builds a small dataset using templates, processes the historical seed in scripted mode and writes the snapshot to the separate public-demo volume. It does not spend API credits:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.public-demo.yml --env-file .env run --rm --no-deps -T demo-app python - --output /app/out/public-demo-snapshot.json < scripts/build_demo_snapshot.py
```

Start both the public demo and the team app:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.public-demo.yml --env-file .env up -d
```

The overlay runs both services side-by-side behind a single Caddy:
- `{$DOMAIN}` (`https://209.250.242.163.sslip.io`): Public demo with private visitor workspaces, no authentication required.
- `team.{$DOMAIN}` (`https://team.209.250.242.163.sslip.io`): Team dashboard, protected by `BASIC_AUTH_USER` and `BASIC_AUTH_HASH`.

Validate access without a browser's remembered credentials:
- `curl -I https://209.250.242.163.sslip.io/api/health` returns HTTP 200.
- `curl -I https://team.209.250.242.163.sslip.io/api/health` returns HTTP 401 Unauthorized without credentials, and HTTP 200 with `-u $BASIC_AUTH_USER:$PASSWORD`.

## Test capacity before sharing the QR

Start with 5 concurrent visitors, then try 10, 20 and 40. Run from a laptop or another server to include network costs; the script only uses Python's standard library. It creates real private sessions and holds live event-stream connections, but never requests a live model run:

```bash
python3 scripts/load_public_demo.py --url https://209.250.242.163.sslip.io --users 5 --rounds 10 --stream-seconds 30
```

In another VM terminal, watch app memory and CPU:

```bash
docker stats
```

Wait for sessions to expire between independent trials; otherwise the later trial includes earlier workspaces. Restarting only the app clears in-memory sessions but may preserve allowance records. Use a staging deployment for capacity tests; restarting the public app disconnects active visitors.

Record errors, p50/p95 request latency, peak memory, CPU and whether event streams remain connected. Initial targets: zero errors below the configured capacity, p95 below 2 seconds for state reads, and at least 25% memory headroom. These are demo acceptance targets, not measured guarantees. This script covers session creation, state snapshots and event-stream connections; it does not simulate rendering, browser interaction, or live-model throughput. Separately try scripted scenarios and navigation in several browser contexts.

If memory or CPU saturates at your expected concurrency, upgrade the VM, lower `DEMO_MAX_WORKSPACES`, or reduce snapshot size. No VM-size guarantee is possible from local results alone. At capacity, a friendly retry response is preferable to exhausting the VM.

Finally, a human should perform one real live run using the configured provider and confirm the second attempt is refused. Check API usage in the provider console. Repeat from a second browser and verify its data and allowance are separate. Live provider checks must be performed by a human, without sharing credentials with an agent.

## Limits

The overlay initially allows 40 active workspaces, 30 minutes idle time and 2 simultaneous live runs. The server also defaults to 500 workspaces created per process lifetime (`DEMO_MAX_TOTAL_WORKSPACES`); restarting the app resets that admission counter. A live run is limited to 60 seconds and 12 provider attempts, with bounded input and output. These are resource limits, not a fixed dollar price: the configured providers determine billing. Retries consume the same allowance. A failed or interrupted live run still spends its allowance.

Use an account-level quota or another server-side admission limit to bound total submission-day spending: anonymous visitors can obtain new browser sessions. The workspace cap bounds concurrent memory use, not the total number of visitors over a day.

Public workspaces are temporary. Do not promise persistence across expiry, deployment or VM restarts. Do not upload real company data. The full generated dataset remains separate; each visitor receives a curated sample with provenance and linked assertions.

## Local smoke measurements (2026-11-08)

Development machine, one Uvicorn process, generated 40-site/303-thread snapshot, 5 state reads per visitor and 2-second event connections; no live model calls:

| New concurrent visitors | Completed | Errors | Request p50 | Request p95 |
| --- | --- | --- | --- | --- |
| 5 | 5 | 0 | 18 ms | 174 ms |
| 20 | 20 | 0 | 65 ms | 598 ms |
| 15 more (40 resident workspaces) | 15 | 0 | 49 ms | 550 ms |

The runs retained earlier workspaces, reaching 40 resident workspaces. A further visitor received the expected HTTP 503 busy response. Measurements mix session initialization and state reads. They are smoke checks, not VM sizing evidence or a sustained-load benchmark. Repeat on the actual deployment and measure memory before choosing the visitor cap.
