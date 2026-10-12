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
    <string>/bin/zsh</string><string>-lc</string><string>exec npm run dev</string>
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
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
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
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "자동 실행을 해제했습니다."
    ;;
  *)
    echo "사용법: $0 install | restart | status | uninstall"; exit 1 ;;
esac
