#!/usr/bin/env bash
# Show every place Chatrix Node / PM2 / systemd / nvm is still running.
#   sudo bash find-chatrix.sh

set -u

APP_DIR="${APP_DIR:-/var/www/ChatrixCharitySystem}"

echo "======== processes ========"
ps -eo user,pid,ppid,cmd | grep -E 'ChatrixCharitySystem|backend/src/index.js' | grep -v grep || echo "(no matching process)"

echo
echo "======== ports 4173 / 4179 ========"
ss -lptn | grep -E ':4173|:4179' || echo "(ports free)"

echo
echo "======== systemd units ========"
systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -iE 'chatrix|charity' || true
systemctl list-unit-files --no-pager 2>/dev/null | grep -iE 'chatrix|charity' || true
echo "unit files:"
ls /etc/systemd/system /lib/systemd/system 2>/dev/null | grep -iE 'chatrix|charity' || echo "(none named chatrix/charity)"

pid="$(pgrep -n -f "${APP_DIR}/backend/src/index.js" || true)"
if [ -n "${pid}" ]; then
  echo
  echo "======== systemd owner of pid ${pid} ========"
  systemctl status "${pid}" --no-pager || true
  echo
  echo "======== exe / cwd of pid ${pid} ========"
  ls -l "/proc/${pid}/exe" 2>/dev/null || true
  readlink -f "/proc/${pid}/cwd" 2>/dev/null || true
  tr '\0' ' ' < "/proc/${pid}/environ" 2>/dev/null | tr ' ' '\n' | grep -E '^(HOME|USER|NVM_DIR|PATH|PORT)=' || true
fi

echo
echo "======== PM2 for each user ========"
for u in root chatrix www-data ubuntu; do
  id "$u" >/dev/null 2>&1 || continue
  home="$(getent passwd "$u" | cut -d: -f6)"
  echo "--- user $u home=$home ---"
  sudo -u "$u" -H bash -lc 'command -v pm2 && pm2 list' 2>/dev/null || echo "(no pm2 or empty)"
  if [ -s "${home}/.nvm/nvm.sh" ]; then
    echo "nvm: ${home}/.nvm"
  fi
done

echo
echo "======== crontabs ========"
for u in root chatrix www-data ubuntu; do
  id "$u" >/dev/null 2>&1 || continue
  echo "--- crontab $u ---"
  crontab -u "$u" -l 2>/dev/null | grep -iE 'chatrix|node|pm2|index.js' || echo "(none)"
done

echo
echo "======== supervisor ========"
ls /etc/supervisor/conf.d 2>/dev/null || echo "(no supervisor conf.d)"
