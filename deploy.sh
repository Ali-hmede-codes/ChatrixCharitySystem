#!/usr/bin/env bash
# CloudPanel deploy for Chatrix Charity System.
# Installs NVM + Node 20, system build tools, npm deps, frontend build, PM2.
# Nginx stays as you already set it (proxy to 127.0.0.1:$APP_PORT).
#
# Usage:
#   sudo bash deploy.sh
#     (asks for CloudPanel user, domain, app port, and firewall ports)
#   sudo bash deploy.sh --user SITEUSER --domain example.com --port 4173 --open 80,443
#
# If you uploaded this file from Windows and it fails with $'\r':
#   sed -i 's/\r$//' deploy.sh && bash deploy.sh

set -euo pipefail

# =============================================================================
# EDIT THESE
# =============================================================================
SITE_USER="${SITE_USER:-}"
DOMAIN="${DOMAIN:-}"
APP_DIR="${APP_DIR:-}"
REPO_URL="${REPO_URL:-https://github.com/Ali-hmede-codes/ChatrixCharitySystem.git}"
BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-chatrix}"
APP_PORT="${APP_PORT:-4173}"
LOCK_PORT="${LOCK_PORT:-4179}"
# 127.0.0.1 = only Nginx can reach Node (recommended).
# 0.0.0.0   = also reachable on the server IP:APP_PORT
HOST="${HOST:-127.0.0.1}"
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

  --user NAME        Linux / CloudPanel site user
  --domain NAME      Domain folder under /home/USER/htdocs/DOMAIN
  --dir PATH         App directory (overrides --domain)
  --repo URL         Git repo to clone or pull
  --branch NAME      Git branch (default: main)
  --name NAME        PM2 process name (default: chatrix)
  --port N           App HTTP port (default: 4173)
  --lock N           Internal lock port (default: 4179)
  --host ADDR        Bind address (default: 127.0.0.1)
  --open PORTS       Firewall ports, e.g. 80,443 or 80 443 4173
  --node VER         Node version for nvm (default: 20, or .nvmrc)
  -h, --help         Show this help

With no flags, the script asks for user, domain, and ports.
EOF
}

PROVIDED_USER=0
PROVIDED_DOMAIN=0
PROVIDED_DIR=0
PROVIDED_PORT=0
PROVIDED_LOCK=0
PROVIDED_OPEN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SITE_USER="${2:-}"; PROVIDED_USER=1; shift 2 ;;
    --domain) DOMAIN="${2:-}"; PROVIDED_DOMAIN=1; shift 2 ;;
    --dir) APP_DIR="${2:-}"; PROVIDED_DIR=1; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --name) APP_NAME="${2:-}"; shift 2 ;;
    --port) APP_PORT="${2:-}"; PROVIDED_PORT=1; shift 2 ;;
    --lock) LOCK_PORT="${2:-}"; PROVIDED_LOCK=1; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
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
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo
echo "Chatrix deploy — press Enter to keep the value in [brackets]"
echo

ask_var SITE_USER "$PROVIDED_USER" "CloudPanel site user" "$(guess_user)"
[ -n "$SITE_USER" ] || die "Site user is required"
id "$SITE_USER" >/dev/null 2>&1 || die "User '$SITE_USER' does not exist. Check Sites → the site user in CloudPanel."

ask_var DOMAIN "$PROVIDED_DOMAIN" "Domain (folder under /home/$SITE_USER/htdocs)" ""
ask_var APP_PORT "$PROVIDED_PORT" "App port for Nginx / CloudPanel Node.js site" "4173"
ask_var LOCK_PORT "$PROVIDED_LOCK" "Internal lock port (not used in CloudPanel)" "4179"
ask_var FIREWALL_PORTS "$PROVIDED_OPEN" "Firewall ports to allow" "80,443"

if [ -z "$APP_DIR" ]; then
  if [ "$PROVIDED_DIR" = 0 ] && [ -f "$SCRIPT_DIR/backend/package.json" ]; then
    APP_DIR="$SCRIPT_DIR"
  elif [ -n "$DOMAIN" ]; then
    APP_DIR="/home/${SITE_USER}/htdocs/${DOMAIN}"
  else
    APP_DIR="/home/${SITE_USER}/htdocs/${APP_NAME}"
  fi
fi

valid_port "$APP_PORT" || die "Invalid --port: $APP_PORT"
valid_port "$LOCK_PORT" || die "Invalid --lock: $LOCK_PORT"
[ "$APP_PORT" != "$LOCK_PORT" ] || die "APP_PORT and LOCK_PORT must be different"

SITE_HOME="$(getent passwd "$SITE_USER" | cut -d: -f6)"
[ -n "$SITE_HOME" ] || die "Cannot find home for $SITE_USER"
[ -d "$SITE_HOME" ] || die "Home directory missing: $SITE_HOME"

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
echo "CloudPanel Node.js / Nginx proxy port must be: $APP_PORT"
echo "Public site stays on 80 and 443. Do not put 80 or 443 as the app port."
echo

if [ -t 0 ]; then
  confirm=""
  read -r -p "Continue? [Y/n]: " confirm || true
  case "$confirm" in
    ""|Y|y|yes|YES) ;;
    *) die "Cancelled" ;;
  esac
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
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
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
log "Writing PM2 config and starting $APP_NAME"
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [
    {
      name: "${APP_NAME}",
      cwd: "${APP_DIR}/backend",
      script: "src/index.js",
      interpreter: "${NODE_BIN}",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        HOST: "${HOST}",
        PORT: "${APP_PORT}",
        LOCK_PORT: "${LOCK_PORT}",
        PATH: "${NODE_DIR}:/usr/local/bin:/usr/bin:/bin",
      },
    },
  ],
};
EOF

if is_root; then
  chown "${SITE_USER}:${SITE_USER}" "$APP_DIR/ecosystem.config.cjs"
fi

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
echo "Point Nginx (already set) to: http://127.0.0.1:${APP_PORT}"
echo "Keep websocket / socket.io proxy enabled."
as_site 1 "pm2 status"
