#!/usr/bin/env bash
# Rebuild THIS folder and restart only its PM2 process.
#   cd /var/www/YourSystem && sudo bash update.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=instance.sh
. "${SCRIPT_DIR}/instance.sh"

APP_DIR="$SCRIPT_DIR"
SITE_USER="${SITE_USER:-}"
SITE_HOME="${SITE_HOME:-}"

load_rc=0
instance_load_saved "$APP_DIR" || load_rc=$?
if [ "$load_rc" -eq 2 ]; then
  exit 1
fi

if [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  . /root/.nvm/nvm.sh
elif [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

if [ "$load_rc" -ne 0 ] || [ -z "${APP_NAME:-}" ] || [ -z "${APP_PORT:-}" ]; then
  row="$(instance_pm2_row_for "$APP_DIR" || true)"
  if [ -n "$row" ]; then
    IFS=$'\t' read -r APP_NAME APP_PORT LOCK_PORT <<< "$row"
  fi
fi

if [ -z "${APP_NAME:-}" ] || [ -z "${APP_PORT:-}" ]; then
  echo "This folder has no saved name or port." >&2
  echo "Run: sudo bash deploy.sh" >&2
  exit 1
fi

[ -f "${APP_DIR}/backend/package.json" ] || {
  echo "App not found at ${APP_DIR}" >&2
  exit 1
}

cd "${APP_DIR}"
git config --global --add safe.directory "${APP_DIR}" >/dev/null 2>&1 || true

if [ -d .git ]; then
  echo "==> Pulling"
  instance_keep_multisite "$APP_DIR"
  instance_checkout_kept "$APP_DIR"
  set +e
  git pull --ff-only
  pull_rc=$?
  set -e
  instance_restore_multisite "$APP_DIR"
  [ "$pull_rc" -eq 0 ] || exit "$pull_rc"
fi

echo "==> Build (${APP_NAME} port ${APP_PORT})"
# A dropped registry connection can leave exceljs half-extracted (ENOENT /
# ENOTEMPTY). Wipe that folder and retry setup a few times.
export npm_config_fetch_retries="${npm_config_fetch_retries:-5}"
export npm_config_fetch_retry_mintimeout="${npm_config_fetch_retry_mintimeout:-20000}"
export npm_config_fetch_retry_maxtimeout="${npm_config_fetch_retry_maxtimeout:-120000}"

setup_ok=0
for try in 1 2 3; do
  echo "==> npm setup (try ${try}/3)"
  rm -rf "${APP_DIR}/frontend/node_modules/exceljs"
  if npm run setup; then
    setup_ok=1
    break
  fi
  echo "==> setup failed, retrying after a short wait…"
  sleep $((try * 5))
done
if [ "${setup_ok}" -ne 1 ]; then
  echo "npm setup failed after 3 tries (usually a registry network drop)." >&2
  echo "Run: rm -rf frontend/node_modules/exceljs && sudo bash update.sh" >&2
  exit 1
fi

if ! instance_pm2 -v >/dev/null 2>&1; then
  npm install -g pm2
fi

instance_free_port "${APP_PORT}"
instance_free_port "${LOCK_PORT:-}"
sleep 1

if grep -q 'readDeployEnv' ecosystem.config.cjs && [ -f .deploy.env ]; then
  instance_pm2 startOrReload ecosystem.config.cjs --update-env
elif instance_pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  instance_pm2 restart "${APP_NAME}" --update-env
else
  echo "PM2 app ${APP_NAME} is not running. Run: sudo bash deploy.sh" >&2
  exit 1
fi
instance_pm2 save
instance_pm2 list
echo
echo "Nginx for ${APP_NAME} stays on port ${APP_PORT}"
