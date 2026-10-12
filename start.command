#!/bin/zsh
# Double-click in Finder: starts the site and opens it in Chrome.
# Close this window (or press Ctrl+C) to stop the server.
cd "$(dirname "$0")"
( sleep 4; open -a "Google Chrome" http://localhost:5173 2>/dev/null || open http://localhost:5173 ) &
exec npm run dev
