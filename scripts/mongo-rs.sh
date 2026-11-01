#!/usr/bin/env bash
# Local single-node MongoDB replica set for development.
# Runs its own mongod on port 27018 with data under be/.data, so it never
# touches any mongod you already run on 27017.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.data/mongo"
LOG="$ROOT/.data/mongod.log"
PORT=27018
REPL=rs0

start() {
  mkdir -p "$DATA"
  if mongosh --quiet --port "$PORT" --eval 'db.hello().ok' >/dev/null 2>&1; then
    echo "mongod already running on $PORT"
  else
    mongod --dbpath "$DATA" --port "$PORT" --bind_ip 127.0.0.1 \
      --replSet "$REPL" --fork --logpath "$LOG" >/dev/null
    echo "mongod started on $PORT"
  fi
  mongosh --quiet --port "$PORT" --eval "
    try { rs.status() } catch (e) {
      rs.initiate({ _id: '$REPL', members: [{ _id: 0, host: '127.0.0.1:$PORT' }] })
    }" >/dev/null
  echo "replica set $REPL ready"
}

stop() {
  mongod --dbpath "$DATA" --shutdown
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 1 ;;
esac
