#!/usr/bin/env bash
# Update the deployed Workbench: pull, rebuild, restart. Run on the VM: ./deploy/update.sh
set -euo pipefail

cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Pulling $branch"
git pull --ff-only origin "$branch"

echo "==> Building and restarting"
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

echo "==> Removing old images"
docker image prune -f

echo "==> Status"
docker compose -f deploy/docker-compose.yml --env-file .env ps
echo "==> Last logs"
docker compose -f deploy/docker-compose.yml --env-file .env logs --tail=30
