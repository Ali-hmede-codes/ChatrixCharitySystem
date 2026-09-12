#!/usr/bin/env bash
# One-time: remove chatrix-charity PM2 and run Chatrix as root from /var/www.
#
#   cd /var/www/ChatrixCharitySystem
#   sudo bash takeover-root.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"
OLD_USER="${OLD_USER:-chatrix-charity}"

cd "${APP_DIR}"

if [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

echo "==> Stopping Chatrix on user ${OLD_USER}"
if id "${OLD_USER}" >/dev/null 2>&1; then
  sudo -u "${OLD_USER}" -H bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; pm2 delete chatrix >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true' || true
fi

echo "==> Disabling ${OLD_USER} PM2 boot service"
systemctl disable --now pm2-chatrix-charity.service >/dev/null 2>&1 || true

echo "==> Killing leftover Node on 4173/4179"
fuser -k 4173/tcp 4174/tcp 4179/tcp >/dev/null 2>&1 || true
pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
sleep 1

echo "==> Starting Chatrix as root from ${APP_DIR}"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
pm2 delete chatrix >/dev/null 2>&1 || true
pm2 start "${APP_DIR}/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo
pm2 list
echo
ss -lptn | grep -E ':4173|:4179' || echo "4173 not listening yet — check: pm2 logs chatrix"
echo
echo "Control as root:"
echo "  pm2 list"
echo "  pm2 stop chatrix"
echo "  pm2 start chatrix"
echo "  pm2 logs chatrix"
