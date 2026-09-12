#!/usr/bin/env bash
# Control the REAL Chatrix PM2 (user chatrix-charity + nvm).
# Root `pm2 list` will not show this app.
#
#   sudo bash chatrix-pm2.sh list
#   sudo bash chatrix-pm2.sh stop
#   sudo bash chatrix-pm2.sh start

set -euo pipefail

ACTION="${1:-list}"
APP_USER="${APP_USER:-chatrix-charity}"

run_pm2() {
  sudo -u "${APP_USER}" -H bash -lc "export NVM_DIR=\"\$HOME/.nvm\"; . \"\$NVM_DIR/nvm.sh\"; $*"
}

case "${ACTION}" in
  list|status)
    run_pm2 "pm2 list"
    ;;
  stop)
    run_pm2 "pm2 stop chatrix; pm2 save"
    sleep 1
    ss -lptn | grep -E ':4173|:4179' || echo "4173/4179 are free — Chatrix is down"
    ;;
  start|restart)
    run_pm2 "pm2 start chatrix; pm2 save"
    run_pm2 "pm2 list"
    ;;
  logs)
    run_pm2 "pm2 logs chatrix --lines 50"
    ;;
  *)
    echo "Usage: sudo bash chatrix-pm2.sh list|stop|start|logs" >&2
    exit 1
    ;;
esac
