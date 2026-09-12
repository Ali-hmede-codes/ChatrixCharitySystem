#!/usr/bin/env bash
# Pull, rebuild, and register Chatrix in THIS user's PM2 list.
# Default app folder: /var/www/ChatrixCharitySystem
#
#   cd /var/www/ChatrixCharitySystem
#   sudo bash update.sh
#   sudo pm2 list
#
# Use the same user for update.sh and pm2 list (both sudo, or both without).

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"
APP_NAME="${APP_NAME:-chatrix}"

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
elif [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
fi

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required. Install Node 20 first." >&2; exit 1; }

[ -f "${APP_DIR}/backend/package.json" ] || {
  echo "App not found at ${APP_DIR}" >&2
  echo "If the folder is different: APP_DIR=/path/to/app bash update.sh" >&2
  exit 1
}

cd "${APP_DIR}"

if [ -d .git ]; then
  echo "==> Pulling latest code"
  git pull --ff-only
else
  echo "==> No git repo here, using the files already in ${APP_DIR}"
fi

echo "==> Installing packages and building frontend"
npm run setup

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2"
  npm install -g pm2
fi

echo "==> Stopping leftover Chatrix copies so only one PM2 process owns the site"
pm2 stop "${APP_NAME}" >/dev/null 2>&1 || true
if command -v fuser >/dev/null 2>&1; then
  fuser -k 4173/tcp 4174/tcp 4179/tcp >/dev/null 2>&1 || true
fi
sleep 1

echo "==> Starting ${APP_NAME} in PM2"
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo
echo "App dir : ${APP_DIR}"
echo "PM2 user: $(id -un)  (run 'pm2 list' as this same user)"
echo
pm2 list
echo
echo "Logs: pm2 logs ${APP_NAME}"
