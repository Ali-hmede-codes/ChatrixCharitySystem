#!/usr/bin/env bash
# Stop this folder only. Other systems on the same VPS keep running.
#   cd /var/www/YourSystem && sudo bash stop.sh

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

if [ "$load_rc" -ne 0 ] || [ -z "${APP_NAME:-}" ]; then
  row="$(instance_pm2_row_for "$APP_DIR" || true)"
  if [ -n "$row" ]; then
    IFS=$'\t' read -r APP_NAME APP_PORT LOCK_PORT <<< "$row"
  fi
fi

if [ -z "${APP_NAME:-}" ]; then
  echo "No deployed app in ${APP_DIR}."
  echo "Nothing was stopped. Other systems were left running."
  exit 0
fi

echo "==> Stopping ${APP_NAME} (${APP_DIR})"
instance_pm2 stop "${APP_NAME}" >/dev/null 2>&1 || true
instance_free_port "${APP_PORT:-}"
instance_free_port "${LOCK_PORT:-}"
pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
sleep 1

instance_pm2 list || true
echo
if command -v ss >/dev/null 2>&1; then
  ss -lptn | grep -E ":${APP_PORT:-0}|:${LOCK_PORT:-0}" || echo "${APP_NAME} is down. Other systems were not touched."
fi
echo "Start: cd ${APP_DIR} && pm2 start ecosystem.config.cjs && pm2 save"
