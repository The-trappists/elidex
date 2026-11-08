# Deploying the Workbench on a Vultr VM

Goal: the Context Workbench runs on one small VM, behind HTTPS and one shared team password. Everything runs in Docker, so the VM only needs Docker and git.

```
browser --HTTPS--> Caddy (ports 80/443, password) --> app (FastAPI + web UI, port 8000, private)
```

Files: `Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/update.sh`, `.env`.
The state (`state.json`, `llm_calls.jsonl`) lives in the Docker volume `workbench-data`. The Slack bridge (Socket Mode) only makes outbound connections, so it needs no open port.

All `docker compose` commands below run **from the repo root** on the VM.

## 1. Claim the Vultr credits

1. Open <https://mlh.link/vultr-discover> and create or log in to a Vultr account.
2. Redeem the promo code you got from the official Since AI channels (Discord or email). Never paste the code in the repo or in a chat that is not private.
3. Check in Vultr under Billing that the credit is there ($100).

## 2. Create the instance

In Vultr: Products, Deploy, **Cloud Compute** (shared CPU, "Regular" is fine).

- Location: Stockholm or Frankfurt (close to Finland).
- Image: **Ubuntu 24.04 LTS x64**.
- Plan: **1 vCPU / 2 GB RAM** (about $10-12 a month).
- SSH key: add your public key (`cat ~/.ssh/id_ed25519.pub`). If you have none: `ssh-keygen -t ed25519`.
- Leave IPv6 and backups off (backups cost extra).

Wait until the status is "Running" and note the IPv4 address, for example `203.0.113.7`.

```bash
ssh root@203.0.113.7
```

## 3. Firewall

Two layers; use at least the first.

1. Vultr: Products, Firewall, Add group. Rules (IPv4, source `0.0.0.0/0`): TCP 22, TCP 80, TCP 443. Link the group to your instance.
2. On the VM (optional): `ufw allow 22 && ufw allow 80 && ufw allow 443/tcp && ufw allow 443/udp && ufw enable`.

Port 80 must stay open: Caddy needs it to get the certificate. Docker publishes ports itself and bypasses `ufw`, so the Vultr firewall is the one that counts. Only Caddy publishes ports; the app is reachable only through Caddy.

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 5. Clone the repo (private, deploy key)

The repo is private (`The-trappists/since-ai-hackathon`), so give the VM a read-only key.

On the VM:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

On GitHub: repo, Settings, Deploy keys, Add deploy key. Paste the public key, leave "Allow write access" **unchecked**. (Needs repo admin; ask a teammate who has it.)

Back on the VM:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/deploy_key\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:The-trappists/since-ai-hackathon.git
cd since-ai-hackathon
git checkout feat/workbench   # or main, once merged
```

`deploy/update.sh` pulls whichever branch is checked out.

## 6. Create `.env`

```bash
cp .env.example .env
nano .env
```

Set:

- **LLM primary & fallback**: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_JSON_MODE`, `LLM_TIMEOUT` (without an LLM key, the workbench runs in scripted mode). Optional fallback on rate limits: `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL`, `LLM_FALLBACK_JSON_MODE`.
- **Critic role (loop v2)**: `LLM_CRITIC_BASE_URL`, `LLM_CRITIC_API_KEY`, `LLM_CRITIC_MODEL`, `LLM_CRITIC_JSON_MODE`, `LLM_CRITIC_REASONING_EFFORT`.
- **Core pipeline**: `DEFAULT_THREAD_DATE`, `DEFAULT_EMAIL_TIME`, `MIN_CONFIDENCE`.
- **Workbench & Slack**: `WORKBENCH_SIM_START`, `WORKBENCH_IDLE_SECONDS`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID` (see `docs/slack-setup.md`).
- **Big dataset & vector search**: `MONGODB_URI`, `MONGODB_DB`, `TIGER_DATABASE_URL`, `EMBEDDING_MODEL` (see `docs/dataset.md`).
- `DOMAIN`: without buying a domain, use `<server-ip>.sslip.io`, for example `203.0.113.7.sslip.io`. sslip.io resolves that name to the IP, and Caddy gets a real Let's Encrypt certificate for it. If you own a domain, point an A record at the IP and use it.
- `BASIC_AUTH_USER`: for example `team`.
- `BASIC_AUTH_HASH`: generate it, then paste it **between single quotes**:

```bash
docker run --rm caddy:2 caddy hash-password --plaintext 'a-long-shared-password'
```

```
BASIC_AUTH_HASH='$2a$14$abc...'
```

Why the quotes: Docker Compose treats `$name` in `.env` files as a variable to substitute. A bcrypt hash is full of `$` signs (`$2a$14$...`). Single quotes keep the value literal. Writing each `$` as `$$` also works, but do not do both. Without quotes it often still works, but it breaks when a `$` is followed by a letter (that part would silently become empty and you get a permanent 401). We checked that the quoted form reaches Caddy unchanged. After editing, `docker compose -f deploy/docker-compose.yml --env-file .env config | grep HASH` shows the hash with `$$`: that is only how compose prints it.

Share the password with the team in a private channel, not in the repo.

## 7. Start and check

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

The first build takes a few minutes. Then:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env ps
```

Both services should be `Up`, and `app` should become `healthy` after about 20 seconds.

Open `https://203.0.113.7.sslip.io` (your `DOMAIN`). The browser asks for the user and password. The first request may take a few seconds while Caddy gets the certificate.

Check the live stream: the top bar of the UI must show **live**. From a terminal:

```bash
curl -N -u team:PASSWORD https://YOUR_DOMAIN/api/stream
```

Events should print as they happen, not in a burst after a delay.

To try the stack on your own laptop, use `DOMAIN=localhost`: Caddy then signs the certificate with its own internal CA, so the browser shows a warning (accept it) and curl needs `-k`. Ports 80 and 443 must be free on the laptop.

## 8. Updates

After merging or pushing to the deployed branch, on the VM:

```bash
./deploy/update.sh
```

It pulls, rebuilds, restarts, removes old images and prints the status and the last logs. The data volume is kept.

## 9. Logs, backups, reset

Logs (add `-f` to follow, Ctrl+C to leave):

```bash
docker compose -f deploy/docker-compose.yml --env-file .env logs --tail=100 app
docker compose -f deploy/docker-compose.yml --env-file .env logs --tail=100 caddy
```

Backup of the state volume to a tar file in the current folder (the volume is called `context-workbench_workbench-data`, check with `docker volume ls`):

```bash
docker run --rm -v context-workbench_workbench-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/workbench-backup-$(date +%F).tgz -C /data .
```

Download it with `scp root@IP:since-ai-hackathon/workbench-backup-*.tgz .`.

Restore: stop the app, extract into the volume, start again.

```bash
docker compose -f deploy/docker-compose.yml --env-file .env stop app
docker run --rm -v context-workbench_workbench-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data && tar xzf /backup/workbench-backup-YYYY-MM-DD.tgz && chown -R 1000:999 /data"
docker compose -f deploy/docker-compose.yml --env-file .env start app
```

Reset the data (deletes all workbench state, keeps the certificates):

```bash
docker compose -f deploy/docker-compose.yml --env-file .env stop app
docker volume rm context-workbench_workbench-data
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```

Changed `.env`? Run `up -d` again (compose recreates the containers).

## 10. Costs and cleanup

About $10-12 a month for 1 vCPU / 2 GB, so $100 of credit lasts many months. Check Billing now and then.

After the event, destroy the VM so nothing keeps running: back up first (section 9), then Vultr, the instance, Settings, Destroy. Also delete the deploy key on GitHub and rotate the LLM and Slack tokens that were on the VM.

## 11. Troubleshooting

- **Browser certificate error on the real domain**: Caddy could not get the certificate. Check `logs caddy`. Usual causes: port 80 or 443 blocked in the Vultr firewall, `DOMAIN` has a typo, or the DNS/sslip.io name does not point to this server's IP. Let's Encrypt retries on its own, but after many failures it rate-limits for about an hour.
- **Port 80 blocked**: some networks block it; test from another network with `curl -I http://IP`. The firewall group must allow TCP 80 and be linked to the instance.
- **Warning only with `DOMAIN=localhost`**: expected, see section 7.
- **401 even with the right password**: the hash is wrong or got mangled. Regenerate it, put it in single quotes (section 6), run `up -d` again. Check the user name too (`BASIC_AUTH_USER`).
- **UI loads but the top bar never shows "live" / updates arrive late**: the stream is buffered or blocked. Check that `deploy/Caddyfile` still has `flush_interval -1` and that `/api/stream` is excluded from `encode`. Test with `curl -N` (section 7). Corporate proxies can also buffer SSE: try another network.
- **`app` is `unhealthy` or restarting**: `logs app` shows the Python error. A missing or bad `.env` value is the usual cause.
- **Compose says a variable is missing (`set DOMAIN in .env`)**: run the command from the repo root with `--env-file .env`.
- **Disk full**: `docker system df`, then `docker image prune -a` (keeps volumes).
- **Slack bridge silent**: it needs only outbound internet. Check the tokens in `.env` and `logs app`.
