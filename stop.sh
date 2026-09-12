#!/usr/bin/env bash
# Stop PM2 chatrix and kill leftover Node copies of THIS app.
# Folder: /var/www/ChatrixCharitySystem

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"
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
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${APP_PORT}/tcp" "4174/tcp" "${LOCK_PORT}/tcp" >/dev/null 2>&1 || true
fi

if command -v pkill >/dev/null 2>&1; then
  pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
  pkill -f "${APP_DIR}/backend" >/dev/null 2>&1 || true
fi

sleep 1

echo
echo "PM2 chatrix:"
if command -v pm2 >/dev/null 2>&1; then
  pm2 list | grep -E 'chatrix|name' || pm2 list
fi

echo
echo "What is still listening (leftover Node or Nginx):"
if command -v ss >/dev/null 2>&1; then
  ss -lptn | grep -E ':4173|:4174|:4179|:80|:443' || echo "(nothing on 4173/4174/4179/80/443)"
fi

echo
echo "If :80 or :443 still show nginx, the HTML page can still open."
echo "That is Nginx, not Chatrix. Chatrix is only Node on ${APP_PORT}."
echo "Start again: cd ${APP_DIR} && pm2 start ecosystem.config.cjs && pm2 save"
