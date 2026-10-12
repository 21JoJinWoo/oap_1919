#!/bin/zsh
# macOS: keeps the dev server running in the background (starts at login,
# restarts if it stops), so http://localhost:5173 always opens.
#
#   ./scripts/autostart.sh install    # set up once
#   ./scripts/autostart.sh restart    # after `git pull` changed server code
#   ./scripts/autostart.sh status
#   ./scripts/autostart.sh uninstall
set -euo pipefail

LABEL="com.oap1919.dev"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/oap1919.log"
DOMAIN="gui/$(id -u)"

# Stops the agent and waits (up to 10 s) until launchd has fully removed it.
unload_agent() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  for _ in {1..20}; do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

case "${1:-}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string><string>exec ./scripts/run-with-sync.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    unload_agent
    # bootstrap can fail with "5: Input/output error" while launchd is still
    # tearing down the previous instance: retry, then fall back to `load`.
    if ! launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then
      sleep 2
      launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
    fi
    echo "설치 완료. 몇 초 뒤 크롬에서 http://localhost:5173 을 여세요. (로그: $LOG)"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "재시작했습니다."
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "자동 실행 켜짐"; tail -n 5 "$LOG" 2>/dev/null || true
    else
      echo "자동 실행 꺼짐"
    fi
    ;;
  uninstall)
    unload_agent
    rm -f "$PLIST"
    echo "자동 실행을 해제했습니다."
    ;;
  *)
    echo "사용법: $0 install | restart | status | uninstall"; exit 1 ;;
esac
