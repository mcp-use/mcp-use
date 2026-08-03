#!/usr/bin/env bash
# Starts the mcp-use conformance fixture, waits for its own endpoint, and
# always tears it down before returning the referee's exit status.
set -euo pipefail

PORT="${PORT:-3000}"
SERVER_URL="http://127.0.0.1:${PORT}/mcp"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_DIR="$(cd "${CLIENT_DIR}/../../../server/examples/conformance" && pwd)"
MCP_USE_BIN="$(cd "${SERVER_DIR}/../.." && pwd)/dist/bin.js"

if (: >"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
  echo "Error: port ${PORT} is already in use; refusing to test a stale server." >&2
  exit 1
fi

cd "${CLIENT_DIR}"
(
  cd "${SERVER_DIR}"
  exec node "${MCP_USE_BIN}" dev --port "${PORT}" --no-open
) &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" 2>/dev/null || true
  wait "${SERVER_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 2 "${SERVER_URL}" >/dev/null 2>&1; then
    pnpm exec conformance server --url "${SERVER_URL}" "$@"
    exit $?
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "Conformance fixture exited before becoming ready." >&2
    exit 1
  fi
  sleep 0.5
done

echo "Conformance fixture did not become ready after 30 seconds." >&2
exit 1
