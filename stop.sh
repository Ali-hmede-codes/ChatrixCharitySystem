#!/usr/bin/env bash
# Stop Chatrix in PM2 and kill leftover Node copies on the app ports.
# After this, the website should be down until you start PM2 again.

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/CharityChatrixSystem}"
APP_NAME="${APP_NAME:-chatrix}"
APP_PORT="${PORT:-4173}"
LOCK_PORT="${LOCK_PORT:-4179}"

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
elif [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2 stop "${APP_NAME}" >/dev/null 2>&1 || true
  pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${APP_PORT}/tcp" "4174/tcp" "${LOCK_PORT}/tcp" >/dev/null 2>&1 || true
fi

if command -v pkill >/dev/null 2>&1; then
  pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
fi

echo "Chatrix is stopped. Website should be down."
echo "Start again: cd ${APP_DIR} && sudo pm2 start ecosystem.config.cjs && sudo pm2 save"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list
fi
