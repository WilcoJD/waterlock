#!/usr/bin/env bash
# Start the whole platform locally with every integration mocked.
# Usage: scripts/dev.sh [port]
set -euo pipefail
cd "$(dirname "$0")/../backend"
[[ -d node_modules ]] || npm install
[[ -f .env ]] || cp .env.example .env
export PORT="${1:-8080}" PROXMOX_MOCK=true UPCLOUD_MOCK=true GATEWAY_MOCK=true MARKET_MAKER=true ALLOW_FAUCET=true ALLOW_DEV_REWARDS=true
export PUBLIC_URL="http://localhost:$PORT"
echo "→ http://localhost:$PORT  (admin: first account whose email is in ADMIN_EMAILS, or the setup wizard)"
exec node --disable-warning=ExperimentalWarning src/server.js
