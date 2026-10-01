#!/usr/bin/env bash
# Deploy one Chatrix system with PM2.
# The app folder is the folder that contains this script (upload each system
# into its own directory). Name and ports are chosen so several systems can
# run on the same VPS without sharing a PM2 name or TCP port.
# Nginx for THIS copy proxies to 127.0.0.1:$APP_PORT.
#
# Usage:
#   cd /var/www/mosque-aid && sudo bash deploy.sh
#   cd /var/www/school-aid && sudo bash deploy.sh
#   sudo bash deploy.sh --port 4183 --name school-aid
#   sudo bash update.sh
#
# If you uploaded this file from Windows and it fails with $'\r':
#   sed -i 's/\r$//' *.sh && bash deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=instance.sh
. "${SCRIPT_DIR}/instance.sh"

# =============================================================================
# EDIT THESE
# =============================================================================
SITE_USER="${SITE_USER:-}"
DOMAIN="${DOMAIN:-}"
APP_DIR="${APP_DIR:-}"
REPO_URL="${REPO_URL:-https://github.com/Ali-hmede-codes/ChatrixCharitySystem.git}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-}"
APP_PORT="${APP_PORT:-}"
LOCK_PORT="${LOCK_PORT:-}"
# 127.0.0.1 = only Nginx can reach Node (recommended).
# 0.0.0.0   = also reachable on the server IP:APP_PORT
HOST="${HOST:-}"
# Extra TCP ports to allow when UFW is already active (comma or space).
FIREWALL_PORTS="${FIREWALL_PORTS:-80,443}"
NODE_VERSION="${NODE_VERSION:-20}"
NVM_VERSION="${NVM_VERSION:-v0.40.3}"

# =============================================================================
# CLI
# =============================================================================
usage() {
  cat <<'EOF'
Usage: sudo bash deploy.sh [options]

  --user NAME        Linux user that owns the app and PM2 list
  --domain NAME      Optional CloudPanel folder under /home/USER/htdocs
  --dir PATH         App directory (default: the folder that contains deploy.sh)
  --repo URL         Git repo to clone or pull
  --branch NAME      Git branch (default: main)
  --name NAME        PM2 process name (default: folder name)
  --port N           App HTTP port (default: first free pair, starting at 4173)
  --lock N           Internal lock port (default: app port + 6)
  --host ADDR        Bind address (default: 127.0.0.1)
  --open PORTS       Firewall ports, e.g. 80,443 or 80 443 4173
  --node VER         Node version for nvm (default: 20, or .nvmrc)
  -h, --help         Show this help

The folder, PM2 name, and ports are chosen automatically.
Upload the next system into a different folder and run deploy.sh there.
EOF
}

PROVIDED_USER=0
PROVIDED_DOMAIN=0
PROVIDED_DIR=0
PROVIDED_PORT=0
PROVIDED_LOCK=0
PROVIDED_NAME=0
PROVIDED_HOST=0
PROVIDED_OPEN=0

[ -n "$APP_DIR" ] && PROVIDED_DIR=1
[ -n "$APP_PORT" ] && PROVIDED_PORT=1
[ -n "$LOCK_PORT" ] && PROVIDED_LOCK=1
[ -n "$APP_NAME" ] && PROVIDED_NAME=1
[ -n "$HOST" ] && PROVIDED_HOST=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SITE_USER="${2:-}"; PROVIDED_USER=1; shift 2 ;;
    --domain) DOMAIN="${2:-}"; PROVIDED_DOMAIN=1; shift 2 ;;
    --dir) APP_DIR="${2:-}"; PROVIDED_DIR=1; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --name) APP_NAME="${2:-}"; PROVIDED_NAME=1; shift 2 ;;
    --port) APP_PORT="${2:-}"; PROVIDED_PORT=1; shift 2 ;;
    --lock) LOCK_PORT="${2:-}"; PROVIDED_LOCK=1; shift 2 ;;
    --host) HOST="${2:-}"; PROVIDED_HOST=1; shift 2 ;;
    --open) FIREWALL_PORTS="${2:-}"; PROVIDED_OPEN=1; shift 2 ;;
    --node) NODE_VERSION="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

is_root() { [ "$(id -u)" -eq 0 ]; }

parse_ports() {
  echo "$1" | tr ',' ' ' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//'
}

valid_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

guess_user() {
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    printf '%s' "$SUDO_USER"
  else
    printf '%s' "$(id -un)"
  fi
}

ask_var() {
  local varname="$1" provided="$2" label="$3" default="$4"
  local current reply=""
  eval "current=\"\${$varname:-}\""
  [ -z "$current" ] && current="$default"

  if [ "$provided" = 1 ]; then
    return 0
  fi

  if [ ! -t 0 ]; then
    printf -v "$varname" '%s' "$current"
    return 0
  fi

  if [ -n "$current" ]; then
    read -r -p "$label [$current]: " reply || true
  else
    read -r -p "$label: " reply || true
  fi

  if [ -n "$reply" ]; then
    printf -v "$varname" '%s' "$reply"
  else
    printf -v "$varname" '%s' "$current"
  fi
}

# Run as the site user. $1 = 1 to load nvm first, $2 = command.
as_site() {
  local load_nvm="$1"
  local cmd="$2"
  local wrapper

  wrapper="set -euo pipefail
export HOME=\"\$HOME\"
export NVM_DIR=\"\$HOME/.nvm\"
"
  if [ "$load_nvm" = 1 ]; then
    wrapper="${wrapper}
[ -s \"\$NVM_DIR/nvm.sh\" ] || { echo \"nvm is not installed\" >&2; exit 1; }
. \"\$NVM_DIR/nvm.sh\"
"
  fi
  wrapper="${wrapper}
${cmd}
"

  if [ "$(id -un)" = "$SITE_USER" ]; then
    env HOME="$SITE_HOME" NVM_DIR="${SITE_HOME}/.nvm" bash -c "$wrapper"
  else
    sudo -H -u "$SITE_USER" env HOME="$SITE_HOME" NVM_DIR="${SITE_HOME}/.nvm" bash -c "$wrapper"
  fi
}

# =============================================================================
# Ask + resolve paths and user
# =============================================================================
CLI_PORT=""
CLI_LOCK=""
CLI_NAME=""
[ "$PROVIDED_PORT" = 1 ] && CLI_PORT="$APP_PORT"
[ "$PROVIDED_LOCK" = 1 ] && CLI_LOCK="$LOCK_PORT"
[ "$PROVIDED_NAME" = 1 ] && CLI_NAME="$APP_NAME"

port_free_for_us() {
  local port="$1"
  if instance_foreign_has_port "$port"; then
    return 1
  fi
  if instance_tcp_open "$port" && ! instance_listener_ours "$port"; then
    return 1
  fi
  return 0
}

allocate_ports() {
  local p lock
  p=4173
  while [ "$p" -le 60000 ]; do
    lock=$((p + 6))
    if port_free_for_us "$p" && port_free_for_us "$lock"; then
      APP_PORT="$p"
      LOCK_PORT="$lock"
      return 0
    fi
    p=$((p + 10))
  done
  die "No free port pair left on this VPS (tried 4173-60000)."
}

unique_name() {
  local base="$1" name n
  name="$base"
  n=2
  while instance_foreign_has_name "$name"; do
    name="${base}-${n}"
    n=$((n + 1))
    [ "$n" -lt 200 ] || die "Could not find a free PM2 name starting at ${base}"
  done
  printf '%s' "$name"
}

find_free_lock() {
  local p="$1" lock
  lock=$((p + 6))
  if [ "$lock" -le 65535 ] && port_free_for_us "$lock"; then
    printf '%s' "$lock"
    return 0
  fi
  lock=4179
  while [ "$lock" -le 60006 ]; do
    if [ "$lock" != "$p" ] && port_free_for_us "$lock"; then
      printf '%s' "$lock"
      return 0
    fi
    lock=$((lock + 1))
  done
  return 1
}

resolve_instance_identity() {
  local saved_dir saved_name saved_port saved_lock saved_host row eco_name eco_cwd
  NODE_BIN="${NODE_BIN:-}"
  instance_collect_foreign "$APP_DIR"
  saved_dir="$(instance_env_get "$APP_DIR/.deploy.env" APP_DIR)"
  if [ -n "$saved_dir" ] && [ "$(instance_realpath "$saved_dir")" = "$(instance_realpath "$APP_DIR")" ]; then
    saved_name="$(instance_env_get "$APP_DIR/.deploy.env" APP_NAME)"
    saved_port="$(instance_env_get "$APP_DIR/.deploy.env" APP_PORT)"
    saved_lock="$(instance_env_get "$APP_DIR/.deploy.env" LOCK_PORT)"
    saved_host="$(instance_env_get "$APP_DIR/.deploy.env" HOST)"
    NODE_BIN="$(instance_env_get "$APP_DIR/.deploy.env" NODE_BIN)"
    [ -n "$saved_name" ] && APP_NAME="$saved_name"
    [ -n "$saved_port" ] && APP_PORT="$saved_port"
    [ -n "$saved_lock" ] && LOCK_PORT="$saved_lock"
    if [ "$PROVIDED_HOST" != 1 ] && [ -n "$saved_host" ]; then
      HOST="$saved_host"
    fi
  elif [ -n "$saved_dir" ]; then
    log "Copied profile from ${saved_dir}. This folder will get its own name and ports."
    APP_NAME=""
    APP_PORT=""
    LOCK_PORT=""
    NODE_BIN=""
  else
    row="$(instance_pm2_row_for "$APP_DIR" || true)"
    if [ -n "$row" ]; then
      IFS=$'\t' read -r APP_NAME APP_PORT LOCK_PORT <<< "$row"
      log "Keeping the PM2 app already running from this folder (${APP_NAME})."
    fi
  fi

  if [ -z "${APP_NAME:-}" ] && [ -f "$APP_DIR/ecosystem.config.cjs" ]; then
    eco_name="$(sed -n 's/^[[:space:]]*name:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/ecosystem.config.cjs" | head -n 1)"
    eco_cwd="$(sed -n 's/^[[:space:]]*cwd:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/ecosystem.config.cjs" | head -n 1)"
    if [ -n "$eco_name" ]; then
      if [ -z "$eco_cwd" ] || [ "$eco_cwd" = "$APP_DIR/backend" ] || [ "$eco_cwd" = "$APP_DIR" ]; then
        APP_NAME="$eco_name"
      fi
    fi
  fi

  if [ -z "${APP_NAME:-}" ]; then
    APP_NAME="$(unique_name "$(instance_slug "$(basename "$APP_DIR")")")"
  elif instance_foreign_has_name "$APP_NAME"; then
    log "PM2 name ${APP_NAME} is already used by another folder."
    APP_NAME="$(unique_name "$(instance_slug "$APP_NAME")")"
  fi

  if [ -n "${APP_PORT:-}" ] && port_free_for_us "$APP_PORT"; then
    if [ -z "${LOCK_PORT:-}" ] || [ "$LOCK_PORT" = "$APP_PORT" ] || ! port_free_for_us "$LOCK_PORT"; then
      LOCK_PORT="$(find_free_lock "$APP_PORT")" || die "No free lock port for ${APP_PORT}"
    fi
  elif [ -n "${APP_PORT:-}" ]; then
    log "Saved port ${APP_PORT} is not usable. Picking a free pair."
    log "Point Nginx for this site at the new app port when deploy finishes."
    allocate_ports
  fi
  if [ -z "${APP_PORT:-}" ] || [ -z "${LOCK_PORT:-}" ]; then
    allocate_ports
  fi

  if [ -n "$CLI_NAME" ]; then
    instance_foreign_has_name "$CLI_NAME" && die "PM2 name ${CLI_NAME} is already used by another system."
    APP_NAME="$CLI_NAME"
  fi
  if [ -n "$CLI_PORT" ]; then
    valid_port "$CLI_PORT" || die "Invalid --port: $CLI_PORT"
    port_free_for_us "$CLI_PORT" || die "Port ${CLI_PORT} is already used on this VPS. Omit --port to auto-pick one."
    APP_PORT="$CLI_PORT"
  fi
  if [ -n "$CLI_LOCK" ]; then
    valid_port "$CLI_LOCK" || die "Invalid --lock: $CLI_LOCK"
    [ "$CLI_LOCK" != "$APP_PORT" ] || die "APP_PORT and LOCK_PORT must be different"
    port_free_for_us "$CLI_LOCK" || die "Lock port ${CLI_LOCK} is already used on this VPS."
    LOCK_PORT="$CLI_LOCK"
  elif [ -n "$CLI_PORT" ]; then
    if [ -z "${LOCK_PORT:-}" ] || [ "$LOCK_PORT" = "$APP_PORT" ] || ! port_free_for_us "$LOCK_PORT"; then
      LOCK_PORT="$(find_free_lock "$APP_PORT")" || die "No free lock port for ${APP_PORT}"
    fi
  fi

  [ -n "$HOST" ] || HOST="127.0.0.1"
  case "$HOST" in
    *[!0-9a-zA-Z.:-]*) die "Invalid host: $HOST" ;;
  esac
  valid_port "$APP_PORT" || die "Invalid app port: $APP_PORT"
  valid_port "$LOCK_PORT" || die "Invalid lock port: $LOCK_PORT"
  [ "$APP_PORT" != "$LOCK_PORT" ] || die "APP_PORT and LOCK_PORT must be different"
}

save_instance_profile() {
  instance_write_env "${APP_DIR}/.deploy.env"
  if is_root; then
    chown "${SITE_USER}:${SITE_USER}" "${APP_DIR}/.deploy.env"
  fi
}

echo
echo "Chatrix deploy — folder, name, and ports are automatic"
echo

ask_var SITE_USER "$PROVIDED_USER" "Linux user for files and PM2" "$(guess_user)"
[ -n "$SITE_USER" ] || die "Site user is required"
id "$SITE_USER" >/dev/null 2>&1 || die "User '$SITE_USER' does not exist."

if [ "$PROVIDED_DOMAIN" = 1 ]; then
  ask_var DOMAIN "$PROVIDED_DOMAIN" "CloudPanel domain folder (optional)" ""
fi
ask_var FIREWALL_PORTS "$PROVIDED_OPEN" "Firewall ports to allow" "80,443"

if [ "$PROVIDED_DIR" = 1 ]; then
  [ -n "$APP_DIR" ] || die "--dir needs a path"
elif [ -f "$SCRIPT_DIR/backend/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"
elif [ -n "${DOMAIN:-}" ]; then
  APP_DIR="/home/${SITE_USER}/htdocs/${DOMAIN}"
else
  APP_DIR="/var/www/ChatrixCharitySystem"
fi

mkdir -p "$APP_DIR"
APP_DIR="$(cd "$APP_DIR" && pwd)"
[ "$APP_DIR" != "/" ] || die "Refusing to deploy into /"

SITE_HOME="$(getent passwd "$SITE_USER" | cut -d: -f6)"
[ -n "$SITE_HOME" ] || die "Cannot find home for $SITE_USER"
[ -d "$SITE_HOME" ] || die "Home directory missing: $SITE_HOME"

resolve_instance_identity

OPEN_LIST="$(parse_ports "$FIREWALL_PORTS")"
for p in $OPEN_LIST; do
  valid_port "$p" || die "Invalid firewall port: $p"
done

echo
echo "Site user : $SITE_USER"
echo "App dir   : $APP_DIR"
echo "Repo      : $REPO_URL ($BRANCH)"
echo "PM2 name  : $APP_NAME"
echo "Bind      : ${HOST}:${APP_PORT}  lock=${LOCK_PORT}"
echo "Node/nvm  : nvm ${NVM_VERSION} + Node ${NODE_VERSION}"
echo "Firewall  : ${OPEN_LIST:-<none>}"
echo
if [ -n "${FOREIGN_LIST:-}" ]; then
  echo "Other systems already on this VPS:"
  printf '%s\n' "$FOREIGN_LIST" | sed '/^$/d' | sort -u | sed 's/^/  /'
else
  echo "Other systems already on this VPS: none"
fi
echo
echo "CloudPanel / Nginx for THIS site must proxy to: ${APP_PORT}"
echo "Public site stays on 80 and 443. Do not put 80 or 443 as the app port."
echo "The next upload goes in a different folder. Run deploy.sh there."
echo

if [ -t 0 ]; then
  confirm=""
  read -r -p "Continue? [Y/n]: " confirm || true
  case "$confirm" in
    ""|Y|y|yes|YES) ;;
    *) die "Cancelled" ;;
  esac
fi

# Reserve the name and ports before install so the next folder on this VPS
# will not pick the same ones. Skip when this directory still has to be cloned.
if [ -f "$APP_DIR/backend/package.json" ]; then
  save_instance_profile
fi

# =============================================================================
# System packages needed to clone, compile better-sqlite3, and fetch nvm
# =============================================================================
if is_root && command -v apt-get >/dev/null 2>&1; then
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y \
    git \
    curl \
    ca-certificates \
    build-essential \
    python3 \
    make \
    g++
elif ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  die "Need git and curl. Re-run with sudo so apt can install them."
fi

command -v git >/dev/null 2>&1 || die "git is required"
command -v curl >/dev/null 2>&1 || die "curl is required"

# =============================================================================
# Download / update
# =============================================================================
log "Downloading project into $APP_DIR"
mkdir -p "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  instance_keep_multisite "$APP_DIR"
  instance_checkout_kept "$APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  set +e
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  pull_rc=$?
  set -e
  instance_restore_multisite "$APP_DIR"
  [ "$pull_rc" -eq 0 ] || die "git pull failed"
elif [ -f "$APP_DIR/backend/package.json" ]; then
  log "Existing project folder found, skipping clone"
else
  if [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
    die "$APP_DIR is not empty and is not a git repo. Set --dir to an empty folder or the project path."
  fi
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

[ -f "$APP_DIR/backend/package.json" ] || die "backend/package.json not found in $APP_DIR"

if [ -f "$APP_DIR/.nvmrc" ]; then
  NODE_VERSION="$(tr -d '[:space:]' < "$APP_DIR/.nvmrc")"
fi

# =============================================================================
# Permissions
# =============================================================================
log "Setting file permissions"
if is_root; then
  chown -R "${SITE_USER}:${SITE_USER}" "$APP_DIR"
fi
chmod 755 "$APP_DIR"
mkdir -p "$APP_DIR/backend/.auth" "$APP_DIR/backend/auth_session"
chmod 700 "$APP_DIR/backend/.auth" "$APP_DIR/backend/auth_session"
if is_root; then
  chown -R "${SITE_USER}:${SITE_USER}" "$APP_DIR/backend/.auth" "$APP_DIR/backend/auth_session"
fi

# Folder is on disk now (upload or clone). Keep the reservation.
save_instance_profile

# =============================================================================
# NVM + Node + PM2 (installed for the site user, not root)
# =============================================================================
log "Installing nvm, Node ${NODE_VERSION}, and PM2 for $SITE_USER"
as_site 0 "
  export NVM_DIR=\"\$HOME/.nvm\"
  if [ ! -s \"\$NVM_DIR/nvm.sh\" ]; then
    curl -fsSL 'https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh' | bash
  fi
  . \"\$NVM_DIR/nvm.sh\"
  cd '${APP_DIR}'
  nvm install '${NODE_VERSION}'
  nvm use '${NODE_VERSION}'
  nvm alias default '${NODE_VERSION}'
  npm install -g pm2
  node -v
  npm -v
  pm2 -v
"

NODE_BIN="$(as_site 1 'command -v node' | tail -n1 | tr -d '\r')"
NPM_BIN="$(as_site 1 'command -v npm' | tail -n1 | tr -d '\r')"
PM2_BIN="$(as_site 1 'command -v pm2' | tail -n1 | tr -d '\r')"
[ -x "$NODE_BIN" ] || die "nvm node binary not found"
[ -x "$NPM_BIN" ] || die "nvm npm binary not found"
[ -x "$PM2_BIN" ] || die "pm2 binary not found"
NODE_DIR="$(dirname "$NODE_BIN")"

echo "node : $NODE_BIN ($("$NODE_BIN" -v))"
echo "npm  : $NPM_BIN"
echo "pm2  : $PM2_BIN"

save_instance_profile

# =============================================================================
# Firewall
# =============================================================================
if [ -n "$OPEN_LIST" ] && command -v ufw >/dev/null 2>&1; then
  if ufw status 2>/dev/null | grep -qi "Status: active"; then
    log "Allowing firewall ports: $OPEN_LIST"
    is_root || die "UFW is active. Re-run with sudo to open ports."
    for p in $OPEN_LIST; do
      ufw allow "${p}/tcp" comment "${APP_NAME}"
    done
    ufw status numbered | sed -n '1,40p'
  else
    log "UFW is installed but not active, skipping port rules"
  fi
elif [ -n "$OPEN_LIST" ]; then
  log "UFW not found. Open these ports in CloudPanel firewall if needed: $OPEN_LIST"
fi

# =============================================================================
# Install + build with the nvm Node
# =============================================================================
log "Installing npm packages and building frontend"
as_site 1 "cd '${APP_DIR}' && npm run setup"

# =============================================================================
# PM2
# =============================================================================
log "Starting $APP_NAME from $APP_DIR"
save_instance_profile

if ! grep -q 'readDeployEnv' "$APP_DIR/ecosystem.config.cjs"; then
  die "ecosystem.config.cjs in $APP_DIR is too old for more than one system. Upload the latest project files, then run deploy.sh again."
fi

while IFS=$'\t' read -r old_name old_cwd _old_port _old_lock; do
  [ -n "$old_name" ] || continue
  if [ -d "$old_cwd" ]; then
    old_real="$(instance_realpath "$old_cwd")"
  else
    old_real="$old_cwd"
  fi
  if [ "$old_real" = "$APP_DIR" ] || [ "$old_real" = "$APP_DIR/backend" ]; then
    as_site 1 "pm2 delete '${old_name}' >/dev/null 2>&1 || true"
  fi
done < <(instance_pm2_rows || true)

as_site 1 "cd '${APP_DIR}' && pm2 delete '${APP_NAME}' >/dev/null 2>&1 || true"
as_site 1 "cd '${APP_DIR}' && pm2 start ecosystem.config.cjs"
as_site 1 "pm2 save"

if is_root; then
  log "Enabling PM2 startup on reboot for $SITE_USER"
  env PATH="${NODE_DIR}:${PATH}" "$PM2_BIN" startup systemd -u "$SITE_USER" --hp "$SITE_HOME" || true
  as_site 1 "pm2 save"
fi

log "Done"
echo "Node     : $("$NODE_BIN" -v) via nvm (${NODE_BIN})"
echo "App      : http://${HOST}:${APP_PORT}"
echo "PM2      : $PM2_BIN status"
echo "Logs     : pm2 logs ${APP_NAME}"
echo "Restart  : pm2 restart ${APP_NAME}"
echo
echo "Point Nginx for THIS site to: http://127.0.0.1:${APP_PORT}"
echo "Keep websocket / socket.io proxy enabled."
echo "Other folders on this VPS keep their own PM2 name and port."
echo
echo "PM2 list is per Linux user. To see ${APP_NAME}:"
echo "  sudo -u ${SITE_USER} -H bash -lc 'pm2 list'"
if [ "$(id -un)" != "$SITE_USER" ]; then
  echo "Your current shell user is $(id -un), so plain 'pm2 list' can look empty."
fi
as_site 1 "pm2 status"
