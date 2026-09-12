#!/usr/bin/env bash
# Pull, rebuild, run as root PM2 from /var/www/ChatrixCharitySystem
#   cd /var/www/ChatrixCharitySystem && sudo bash update.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"

if [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

[ -f "${APP_DIR}/backend/package.json" ] || {
  echo "App not found at ${APP_DIR}" >&2
  exit 1
}

cd "${APP_DIR}"
git config --global --add safe.directory "${APP_DIR}" >/dev/null 2>&1 || true

if [ -d .git ]; then
  echo "==> Pulling"
  git pull --ff-only
fi

echo "==> Build"
npm run setup
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

fuser -k 4173/tcp 4174/tcp 4179/tcp >/dev/null 2>&1 || true
sleep 1

if pm2 describe chatrix >/dev/null 2>&1; then
  pm2 restart chatrix --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save
pm2 list
