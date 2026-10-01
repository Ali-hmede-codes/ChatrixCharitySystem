#!/usr/bin/env bash
# Run THIS folder under root PM2. The directory is the folder that contains
# this script, so each upload stays separate.
#
#   cd /var/www/YourSystem && sudo bash takeover-root.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=instance.sh
. "${SCRIPT_DIR}/instance.sh"

APP_DIR="$SCRIPT_DIR"
OLD_USER="${OLD_USER:-chatrix-charity}"
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

if [ -z "${APP_NAME:-}" ] || [ -z "${APP_PORT:-}" ]; then
  echo "No deployed app in ${APP_DIR}." >&2
  echo "Run: sudo bash deploy.sh" >&2
  exit 1
fi

PROFILE_USER="${SITE_USER:-}"
cd "${APP_DIR}"

stop_folder_pm2() {
  local user="$1" home="$2" old_name old_cwd old_real
  [ -n "$user" ] || return 0
  id "$user" >/dev/null 2>&1 || return 0
  if [ "$(id -un)" = "$user" ]; then
    return 0
  fi
  echo "==> Stopping ${user} PM2 apps that use ${APP_DIR}"
  home="${home:-$(getent passwd "$user" | cut -d: -f6 || true)}"
  SITE_USER="$user"
  SITE_HOME="$home"
  while IFS=$'\t' read -r old_name old_cwd _old_port _old_lock; do
    [ -n "$old_name" ] || continue
    if [ -d "$old_cwd" ]; then
      old_real="$(instance_realpath "$old_cwd")"
    else
      old_real="$old_cwd"
    fi
    if [ "$old_real" = "$APP_DIR" ] || [ "$old_real" = "$APP_DIR/backend" ]; then
      instance_pm2 delete "$old_name" >/dev/null 2>&1 || true
      instance_pm2 save >/dev/null 2>&1 || true
    fi
  done < <(instance_pm2_rows || true)
}

stop_folder_pm2 "$OLD_USER" ""
if [ -n "$PROFILE_USER" ] && [ "$PROFILE_USER" != "$OLD_USER" ]; then
  stop_folder_pm2 "$PROFILE_USER" ""
fi
SITE_USER=""
SITE_HOME=""

echo "==> Disabling legacy ${OLD_USER} PM2 boot service"
systemctl disable --now "pm2-${OLD_USER}.service" >/dev/null 2>&1 || true

echo "==> Freeing ports for ${APP_NAME} only"
instance_free_port "${APP_PORT:-}"
instance_free_port "${LOCK_PORT:-}"
pkill -f "${APP_DIR}/backend/src/index.js" >/dev/null 2>&1 || true
sleep 1

echo "==> Starting ${APP_NAME} as root from ${APP_DIR}"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
HOST="${HOST:-127.0.0.1}"
SITE_USER="root"
SITE_HOME="/root"
if [ -z "${NODE_BIN:-}" ] || [ ! -x "${NODE_BIN}" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
instance_write_env "${APP_DIR}/.deploy.env"
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start "${APP_DIR}/ecosystem.config.cjs"
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo
pm2 list
echo
if [ -n "${APP_PORT:-}" ] && command -v ss >/dev/null 2>&1; then
  ss -lptn | grep -E ":${APP_PORT}|:${LOCK_PORT:-0}" || echo "${APP_PORT} not listening yet — check: pm2 logs ${APP_NAME}"
fi
echo
echo "Control this system as root:"
echo "  pm2 list"
echo "  pm2 stop ${APP_NAME}"
echo "  pm2 start ${APP_NAME}"
echo "  pm2 logs ${APP_NAME}"
