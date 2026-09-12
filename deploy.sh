#!/usr/bin/env bash
# CloudPanel deploy for Chatrix Charity System.
# Nginx stays as you already set it (proxy to 127.0.0.1:$APP_PORT).
#
# Usage:
#   sudo bash deploy.sh
#   sudo bash deploy.sh --port 4173 --lock 4179 --open 80,443
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
# Example: "80,443" or "80 443 4173"
FIREWALL_PORTS="${FIREWALL_PORTS:-80,443}"
NODE_MAJOR="${NODE_MAJOR:-20}"

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
  -h, --help         Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --user) SITE_USER="${2:-}"; shift 2 ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --dir) APP_DIR="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --name) APP_NAME="${2:-}"; shift 2 ;;
    --port) APP_PORT="${2:-}"; shift 2 ;;
    --lock) LOCK_PORT="${2:-}"; shift 2 ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --open) FIREWALL_PORTS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

is_root() { [ "$(id -u)" -eq 0 ]; }

as_site() {
  if [ "$(id -un)" = "$SITE_USER" ]; then
    env PATH="$PATH" bash -c "$*"
  else
    sudo -H -u "$SITE_USER" env PATH="$PATH" HOME="$SITE_HOME" bash -c "$*"
  fi
}

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

parse_ports() {
  echo "$1" | tr ',' ' ' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//'
}

valid_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# =============================================================================
# Resolve paths and user
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$SITE_USER" ]; then
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    SITE_USER="$SUDO_USER"
  else
    SITE_USER="$(id -un)"
  fi
fi

id "$SITE_USER" >/dev/null 2>&1 || die "User '$SITE_USER' does not exist. Set SITE_USER or --user"

if [ -z "$APP_DIR" ]; then
  if [ -f "$SCRIPT_DIR/backend/package.json" ]; then
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

OPEN_LIST="$(parse_ports "$FIREWALL_PORTS")"
for p in $OPEN_LIST; do
  valid_port "$p" || die "Invalid firewall port: $p"
done

echo "Site user : $SITE_USER"
echo "App dir   : $APP_DIR"
echo "Repo      : $REPO_URL ($BRANCH)"
echo "PM2 name  : $APP_NAME"
echo "Bind      : ${HOST}:${APP_PORT}  lock=${LOCK_PORT}"
echo "Firewall  : ${OPEN_LIST:-<none>}"

# =============================================================================
# Packages
# =============================================================================
if is_root && command -v apt-get >/dev/null 2>&1; then
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git curl ca-certificates build-essential python3
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt "$NODE_MAJOR" ]; then
  is_root || die "Node.js ${NODE_MAJOR}+ is required. Run this script with sudo so it can install Node."
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

need_cmd node
need_cmd npm
need_cmd git

[ "$(node_major)" -ge "$NODE_MAJOR" ] || die "Node $(node -v) is too old. Need ${NODE_MAJOR}+"

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2"
  if is_root; then
    npm install -g pm2
  else
    npm install -g pm2
  fi
fi

need_cmd pm2

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
# Install + build
# =============================================================================
log "Installing npm packages and building frontend"
as_site "cd '$APP_DIR/backend' && npm install --omit=dev"
as_site "cd '$APP_DIR/frontend' && npm install && npm run build"

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
      interpreter: "node",
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
      },
    },
  ],
};
EOF

if is_root; then
  chown "${SITE_USER}:${SITE_USER}" "$APP_DIR/ecosystem.config.cjs"
fi

as_site "cd '$APP_DIR' && pm2 delete '${APP_NAME}' >/dev/null 2>&1 || true"
as_site "cd '$APP_DIR' && pm2 start ecosystem.config.cjs"
as_site "pm2 save"

if is_root; then
  log "Enabling PM2 startup on reboot for $SITE_USER"
  env PATH="$PATH" pm2 startup systemd -u "$SITE_USER" --hp "$SITE_HOME" || true
  as_site "pm2 save"
fi

log "Done"
echo "App      : http://${HOST}:${APP_PORT}"
echo "PM2      : pm2 status"
echo "Logs     : pm2 logs ${APP_NAME}"
echo "Restart  : pm2 restart ${APP_NAME}"
echo
echo "Point Nginx (already set) to: http://127.0.0.1:${APP_PORT}"
echo "Keep websocket / socket.io proxy enabled."
as_site "pm2 status"
