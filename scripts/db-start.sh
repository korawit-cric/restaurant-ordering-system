#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --env-file .env -f apps/db/docker-compose.yml up -d --wait postgres
