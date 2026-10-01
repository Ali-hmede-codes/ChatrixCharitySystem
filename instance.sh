#!/usr/bin/env bash
# Shared by deploy.sh, update.sh, stop.sh, and takeover-root.sh.
# Each uploaded folder is one system. Identity lives in that folder's .deploy.env.

instance_realpath() {
  local target="$1"
  if [ -d "$target" ]; then
    (cd "$target" && pwd)
  else
    printf '%s' "$target"
  fi
}

instance_env_get() {
  local file="$1" want="$2" line key val
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line//$'\r'/}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [ "$key" = "$want" ]; then
      printf '%s' "$val"
      return 0
    fi
  done < "$file"
}

instance_slug() {
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
  s="${s:0:32}"
  [ -n "$s" ] || s="chatrix"
  printf '%s' "$s"
}

instance_write_env() {
  local file="$1"
  cat > "$file" <<EOF
# One system per folder. Do not copy this file into another upload.
APP_DIR=${APP_DIR}
APP_NAME=${APP_NAME}
APP_PORT=${APP_PORT}
LOCK_PORT=${LOCK_PORT}
HOST=${HOST}
SITE_USER=${SITE_USER}
NODE_BIN=${NODE_BIN:-}
EOF
  chmod 644 "$file" || true
}

# 0 = loaded, 1 = no profile, 2 = profile belongs to a different folder (unsafe to reuse)
instance_load_saved() {
  local root="$1" saved
  APP_NAME=""
  APP_PORT=""
  LOCK_PORT=""
  if [ ! -f "$root/.deploy.env" ]; then
    return 1
  fi
  saved="$(instance_env_get "$root/.deploy.env" APP_DIR)"
  if [ -z "$saved" ]; then
    return 1
  fi
  if [ "$(instance_realpath "$saved")" != "$(instance_realpath "$root")" ]; then
    printf 'ERROR: %s/.deploy.env belongs to %s.\n' "$root" "$saved" >&2
    printf 'Run sudo bash deploy.sh here so this copy gets its own name and ports.\n' >&2
    return 2
  fi
  APP_NAME="$(instance_env_get "$root/.deploy.env" APP_NAME)"
  APP_PORT="$(instance_env_get "$root/.deploy.env" APP_PORT)"
  LOCK_PORT="$(instance_env_get "$root/.deploy.env" LOCK_PORT)"
  HOST="$(instance_env_get "$root/.deploy.env" HOST)"
  SITE_USER="$(instance_env_get "$root/.deploy.env" SITE_USER)"
  NODE_BIN="$(instance_env_get "$root/.deploy.env" NODE_BIN)"
  [ -n "$HOST" ] || HOST="127.0.0.1"
  return 0
}

instance_pm2_bin() {
  local home="${1:-}" candidate h
  if command -v pm2 >/dev/null 2>&1; then
    command -v pm2
    return 0
  fi
  local homes=()
  [ -n "$home" ] && homes+=("$home")
  [ -n "${HOME:-}" ] && homes+=("$HOME")
  homes+=("/root")
  for h in "${homes[@]}"; do
    candidate="$(ls -1d "$h"/.nvm/versions/node/*/bin/pm2 2>/dev/null | tail -n 1 || true)"
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

instance_parse_jlist() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json, sys
raw = sys.stdin.read()
i = raw.find("[")
if i < 0:
    raise SystemExit(0)
try:
    apps = json.loads(raw[i:])
except Exception:
    raise SystemExit(0)
if not isinstance(apps, list):
    raise SystemExit(0)

def clean(value):
    return str("" if value is None else value).replace("\t", " ").replace("\n", " ").replace("\r", "")

for app in apps:
    if not isinstance(app, dict):
        continue
    env = app.get("pm2_env") or {}
    if not isinstance(env, dict):
        env = {}
    name = clean(app.get("name"))
    if not name:
        continue
    sys.stdout.write("%s\t%s\t%s\t%s\n" % (
        name,
        clean(env.get("pm_cwd")),
        clean(env.get("PORT")),
        clean(env.get("LOCK_PORT")),
    ))
'
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const i = raw.indexOf("[");
  if (i < 0) return;
  let apps;
  try { apps = JSON.parse(raw.slice(i)); } catch { return; }
  if (!Array.isArray(apps)) return;
  const clean = (value) => String(value == null ? "" : value).replace(/[\t\n\r]/g, " ");
  for (const app of apps) {
    if (!app || typeof app !== "object") continue;
    const env = app.pm2_env && typeof app.pm2_env === "object" ? app.pm2_env : {};
    const name = clean(app.name);
    if (!name) continue;
    process.stdout.write([name, clean(env.pm_cwd), clean(env.PORT), clean(env.LOCK_PORT)].join("\t") + "\n");
  }
});
'
    return 0
  fi
  return 0
}

instance_pm2_rows() {
  local bin raw
  bin="$(instance_pm2_bin "${SITE_HOME:-}")" || true
  [ -n "$bin" ] || return 0
  if [ -n "${SITE_USER:-}" ] && [ "$(id -un 2>/dev/null || true)" != "$SITE_USER" ]; then
    raw="$(sudo -H -u "$SITE_USER" "$bin" jlist 2>/dev/null || true)"
  else
    raw="$("$bin" jlist 2>/dev/null || true)"
  fi
  [ -n "$raw" ] || return 0
  printf '%s\n' "$raw" | instance_parse_jlist || true
}

instance_pm2_row_for() {
  local root="$1" real_root name cwd port lock cwd_real
  real_root="$(instance_realpath "$root")"
  while IFS=$'\t' read -r name cwd port lock; do
    [ -n "$name" ] || continue
    if [ -d "$cwd" ]; then
      cwd_real="$(instance_realpath "$cwd")"
    else
      cwd_real="$cwd"
    fi
    if [ "$cwd_real" = "$real_root" ] || [ "$cwd_real" = "$real_root/backend" ]; then
      printf '%s\t%s\t%s\n' "$name" "$port" "$lock"
      return 0
    fi
  done < <(instance_pm2_rows)
  return 1
}

instance_add_foreign_port() {
  local p="$1"
  case "$p" in
    ''|*[!0-9]*) return 0 ;;
  esac
  case "$FOREIGN_PORTS" in
    *" $p "*) ;;
    *) FOREIGN_PORTS="${FOREIGN_PORTS}${p} " ;;
  esac
}

instance_add_foreign_name() {
  local n="$1"
  [ -n "$n" ] || return 0
  case " $FOREIGN_NAMES " in
    *" $n "*) ;;
    *) FOREIGN_NAMES="${FOREIGN_NAMES}${n} " ;;
  esac
}

instance_collect_foreign() {
  local self="$1"
  local self_real file dir claimed claimed_real name port lock root parent seen row cwd_real
  self_real="$(instance_realpath "$self")"
  FOREIGN_PORTS=" "
  FOREIGN_NAMES=" "
  FOREIGN_LIST=""
  local roots=()
  [ -d /var/www ] && roots+=("/var/www")
  [ -d /home ] && roots+=("/home")
  [ -d /opt ] && roots+=("/opt")
  [ -d /srv ] && roots+=("/srv")
  parent="$(dirname "$self_real")"
  roots+=("$parent")
  seen=$'\n'
  for root in "${roots[@]}"; do
    [ -d "$root" ] || continue
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      case "$seen" in
        *$'\n'"$file"$'\n'*) continue ;;
      esac
      seen="${seen}${file}"$'\n'
      dir="$(dirname "$file")"
      claimed="$(instance_env_get "$file" APP_DIR)"
      [ -n "$claimed" ] || claimed="$dir"
      if [ -d "$claimed" ]; then
        claimed_real="$(instance_realpath "$claimed")"
      else
        claimed_real="$claimed"
      fi
      name="$(instance_env_get "$file" APP_NAME)"
      port="$(instance_env_get "$file" APP_PORT)"
      lock="$(instance_env_get "$file" LOCK_PORT)"
      if [ "$claimed_real" = "$self_real" ]; then
        continue
      fi
      instance_add_foreign_port "$port"
      instance_add_foreign_port "$lock"
      instance_add_foreign_name "$name"
      FOREIGN_LIST="${FOREIGN_LIST}${name:-?} ${port:-?} ${claimed_real}"$'\n'
    done < <(find "$root" -maxdepth 6 \( -name node_modules -o -name .git \) -prune -o -name .deploy.env -print 2>/dev/null)
  done

  while IFS=$'\t' read -r name cwd port lock; do
    [ -n "$name" ] || continue
    if [ -d "$cwd" ]; then
      cwd_real="$(instance_realpath "$cwd")"
    else
      cwd_real="$cwd"
    fi
    case "$cwd_real" in
      "$self_real"|"$self_real/backend") continue ;;
    esac
    instance_add_foreign_name "$name"
    instance_add_foreign_port "$port"
    instance_add_foreign_port "$lock"
  done < <(instance_pm2_rows)
}

instance_foreign_has_port() {
  case "$FOREIGN_PORTS" in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

instance_foreign_has_name() {
  case " $FOREIGN_NAMES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

instance_tcp_open() {
  local port="$1" line
  if ! command -v ss >/dev/null 2>&1; then
    return 1
  fi
  line="$(ss -lntH 2>/dev/null | awk '{print $4}' | grep -E ":${port}$" || true)"
  [ -n "$line" ]
}

instance_listener_ours() {
  local port="$1" pids pid cmd
  [ -n "${APP_DIR:-}" ] || return 1
  command -v ss >/dev/null 2>&1 || return 1
  pids="$(ss -lptnH 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" { print }' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true)"
  for pid in $pids; do
    [ -r "/proc/${pid}/cmdline" ] || continue
    cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
    case "$cmd" in
      *"${APP_DIR}/backend"*) return 0 ;;
    esac
  done
  return 1
}

instance_keep_multisite() {
  local root="$1" rel marker src bak
  INSTANCE_KEEP_FILE="$(mktemp)"
  : > "$INSTANCE_KEEP_FILE"
  while IFS='|' read -r rel marker; do
    [ -n "$rel" ] || continue
    src="$root/$rel"
    [ -f "$src" ] || continue
    grep -q "$marker" "$src" || continue
    bak="$(mktemp)"
    cp "$src" "$bak"
    printf '%s|%s|%s\n' "$rel" "$marker" "$bak" >> "$INSTANCE_KEEP_FILE"
  done <<'EOF'
ecosystem.config.cjs|readDeployEnv
instance.sh|instance_collect_foreign
deploy.sh|resolve_instance_identity
update.sh|instance_load_saved
stop.sh|instance_load_saved
takeover-root.sh|stop_folder_pm2
EOF
}

instance_checkout_kept() {
  local root="$1" rel marker bak
  [ -n "${INSTANCE_KEEP_FILE:-}" ] || return 0
  [ -f "$INSTANCE_KEEP_FILE" ] || return 0
  while IFS='|' read -r rel marker bak; do
    [ -n "$rel" ] || continue
    git -C "$root" checkout -- "$rel" 2>/dev/null || true
  done < "$INSTANCE_KEEP_FILE"
}

instance_restore_multisite() {
  local root="$1" rel marker bak src
  [ -n "${INSTANCE_KEEP_FILE:-}" ] || return 0
  [ -f "$INSTANCE_KEEP_FILE" ] || return 0
  while IFS='|' read -r rel marker bak; do
    [ -n "${rel:-}" ] || continue
    [ -n "${bak:-}" ] || continue
    src="$root/$rel"
    if [ ! -f "$src" ] || ! grep -q "$marker" "$src" 2>/dev/null; then
      cp "$bak" "$src"
      printf 'Kept multi-system %s\n' "$rel"
    fi
    rm -f "$bak"
  done < "$INSTANCE_KEEP_FILE"
  rm -f "$INSTANCE_KEEP_FILE"
  INSTANCE_KEEP_FILE=""
}

instance_pm2() {
  local home bin
  if [ -n "${SITE_USER:-}" ] && [ "$(id -un 2>/dev/null || true)" != "$SITE_USER" ]; then
    home="${SITE_HOME:-}"
    if [ -z "$home" ]; then
      home="$(getent passwd "$SITE_USER" | cut -d: -f6 || true)"
    fi
    sudo -H -u "$SITE_USER" env HOME="$home" bash -lc '
      export NVM_DIR="$HOME/.nvm"
      if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$NVM_DIR/nvm.sh"
      fi
      exec pm2 "$@"
    ' bash "$@"
    return
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    bin="$(instance_pm2_bin "${SITE_HOME:-}")" || true
    if [ -n "${bin:-}" ]; then
      "$bin" "$@"
      return
    fi
  fi
  command pm2 "$@"
}

instance_free_port() {
  local port="$1"
  case "$port" in
    ''|*[!0-9]*) return 0 ;;
  esac
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}
