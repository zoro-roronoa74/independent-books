#!/bin/bash
set -e

# Resolve paths
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$HOME/Library/Application Support/IndependentBooks/data"
PROFILE_DIR="$HOME/Library/Application Support/IndependentBooks/profile"
mkdir -p "$DATA_DIR" "$PROFILE_DIR"

DB_PATH="$DATA_DIR/books.sqlite3"
PORT=3543

# Check if port is already running this app
RUNNING_PORT=""
for p in $(seq 3543 3553); do
    STATUS=$(curl -s -m 1 "http://127.0.0.1:$p/api/status" 2>/dev/null || true)
    if echo "$STATUS" | grep -q '"independent":true'; then
        RUNNING_PORT=$p
        break
    fi
    if ! nc -z 127.0.0.1 $p 2>/dev/null && [ -z "$RUNNING_PORT" ]; then
        RUNNING_PORT=$p
    fi
done

PORT=${RUNNING_PORT:-3543}
URL="http://127.0.0.1:$PORT"

# Start background server if not already answering
if ! curl -s -m 1 "$URL/api/status" | grep -q '"independent":true'; then
    if [ -f "$APP_DIR/app_server" ]; then
        "$APP_DIR/app_server" --port "$PORT" --data "$DB_PATH" > /dev/null 2>&1 &
    else
        python3 "$APP_DIR/app_server.py" --port "$PORT" --data "$DB_PATH" > /dev/null 2>&1 &
    fi
    for i in {1..30}; do
        if curl -s -m 1 "$URL/api/status" | grep -q '"independent":true'; then
            break
        fi
        sleep 0.15
    done
fi

# Launch standalone window using Edge, Chrome, or default browser
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ -f "$EDGE" ]; then
    "$EDGE" --user-data-dir="$PROFILE_DIR" --app="$URL" --no-first-run --no-default-browser-check &
elif [ -f "$CHROME" ]; then
    "$CHROME" --user-data-dir="$PROFILE_DIR" --app="$URL" --no-first-run --no-default-browser-check &
else
    open "$URL"
fi
