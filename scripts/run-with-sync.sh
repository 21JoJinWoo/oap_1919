#!/bin/bash
# Runs the dev server and keeps this checkout in sync with GitHub: every
# SYNC_INTERVAL seconds it fast-forwards to the remote branch, reinstalls
# packages / restarts the server when needed. Front-end changes reach the
# open browser through Vite's live reload; scene changes through the page's
# own scene polling. Local edits are never overwritten: an update that would
# touch a locally modified file is skipped and logged.
#
# Started by scripts/autostart.sh (launchd); can also be run by hand.

# Everything lives in main() so bash parses the whole file before running:
# a `git pull` that rewrites this script cannot corrupt the running copy.
main() {
  local self
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  cd "$(dirname "$self")/.." || exit 1
  local interval="${SYNC_INTERVAL:-60}"
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  local server_pid=""
  local last_skipped=""

  log() { echo "[sync $(date '+%Y-%m-%d %H:%M:%S')] $*"; }
  start_server() {
    node --import tsx server/index.ts &
    server_pid=$!
  }
  stop_server() {
    if [ -n "$server_pid" ]; then
      kill "$server_pid" 2>/dev/null
      wait "$server_pid" 2>/dev/null
      server_pid=""
    fi
  }

  trap 'stop_server; exit 0' TERM INT
  log "branch $branch, checking every ${interval}s"
  start_server

  while true; do
    sleep "$interval" &
    wait $!

    if ! kill -0 "$server_pid" 2>/dev/null; then
      log "server was not running; starting it"
      start_server
    fi

    git fetch -q origin "$branch" 2>/dev/null || { log "fetch failed (offline?)"; continue; }
    local old new
    old="$(git rev-parse HEAD)"
    new="$(git rev-parse "origin/$branch")"
    [ "$old" = "$new" ] && continue
    git merge-base --is-ancestor "$old" "$new" || {
      [ "$last_skipped" != "$new" ] && log "update skipped: local commits differ from GitHub"
      last_skipped="$new"
      continue
    }
    if ! git merge --ff-only -q "origin/$branch" 2>/dev/null; then
      # Only scene data edited on the site collides: back it up, then take
      # GitHub's version. Any other local change blocks the update.
      local blocking
      blocking="$(git diff --name-only HEAD "origin/$branch" | while read -r f; do
        git diff --quiet HEAD -- "$f" 2>/dev/null || echo "$f"; done)"
      if [ -n "$blocking" ] && ! echo "$blocking" | grep -qvE '^data/'; then
        local backup="data/backups/$(date '+%Y%m%d-%H%M%S')"
        mkdir -p "$backup"
        echo "$blocking" | while read -r f; do cp "$f" "$backup/" && git checkout -q -- "$f"; done
        log "local scene edits backed up to $backup (GitHub version applied)"
        git merge --ff-only -q "origin/$branch" || { log "update failed after backup"; continue; }
      else
        [ "$last_skipped" != "$new" ] && log "update skipped: it would overwrite local edits ($(git status --porcelain | tr '\n' ' '))"
        last_skipped="$new"
        continue
      fi
    fi

    local changed
    changed="$(git diff --name-only "$old" "$new")"
    log "updated ${old:0:7} -> ${new:0:7}: $(echo "$changed" | tr '\n' ' ')"

    if echo "$changed" | grep -qE '^package(-lock)?\.json$'; then
      log "packages changed; running npm install"
      npm install --no-audit --no-fund
    fi
    if echo "$changed" | grep -qE '^scripts/run-with-sync\.sh$'; then
      log "sync script changed; restarting it"
      stop_server
      exec "$self"
    fi
    if echo "$changed" | grep -qE '^(server/|vite\.config\.ts$|package(-lock)?\.json$|tsconfig\.json$)'; then
      log "server code changed; restarting server"
      stop_server
      start_server
    fi
  done
}

main "$@"
exit
