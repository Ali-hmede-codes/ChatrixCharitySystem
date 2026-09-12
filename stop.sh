#!/usr/bin/env bash
# Stop Chatrix in root PM2 and free ports 4173/4179.
#   cd /var/www/ChatrixCharitySystem && sudo bash stop.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"

if [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
fi

pm2 stop chatrix >/dev/null 2>&1 || true
fuser -k 4173/tcp 4174/tcp 4179/tcp >/dev/null 2>&1 || true
pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
sleep 1

echo "Root PM2:"
pm2 list
echo
ss -lptn | grep -E ':4173|:4179' || echo "4173/4179 free — Chatrix is down"
echo "Start: cd ${APP_DIR} && pm2 start ecosystem.config.cjs && pm2 save"
