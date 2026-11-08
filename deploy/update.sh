#!/usr/bin/env bash
# Update the deployed Dashboard: pull, rebuild, restart. Run on the VM: ./deploy/update.sh
set -euo pipefail

cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Pulling $branch"
git pull --ff-only origin "$branch"

COMPOSE_FILES=("-f" "deploy/docker-compose.yml")
if [ -f "deploy/docker-compose.public-demo.yml" ] && [ "$branch" = "feat/private-demo-workspaces" ]; then
    COMPOSE_FILES+=("-f" "deploy/docker-compose.public-demo.yml")
fi

echo "==> Building and restarting"
docker compose "${COMPOSE_FILES[@]}" --env-file .env up -d --build

echo "==> Removing old images"
docker image prune -f

echo "==> Status"
docker compose "${COMPOSE_FILES[@]}" --env-file .env ps
echo "==> Last logs"
docker compose "${COMPOSE_FILES[@]}" --env-file .env logs --tail=30
