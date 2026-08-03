#!/usr/bin/env bash
# Start the four-server compatibility matrix, run every executable example,
# then stop the servers.
# Run from packages/client.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

echo "Starting demo servers..."
(cd examples/_demo-servers && PORT=3101 pnpm official:v1) &
PIDS+=("$!")
(cd examples/_demo-servers && PORT=3102 pnpm official:v2) &
PIDS+=("$!")
(cd examples/_demo-servers && PORT=3103 pnpm ours:v1) &
PIDS+=("$!")
(cd examples/_demo-servers && PORT=3104 pnpm ours:v2) &
PIDS+=("$!")

for url in \
  http://127.0.0.1:3101/mcp \
  http://127.0.0.1:3102/mcp \
  http://127.0.0.1:3103/mcp \
  http://127.0.0.1:3104/mcp; do
  echo "Waiting for $url ..."
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 -X POST "$url" \
      -H 'content-type: application/json' -d '{}' 2>/dev/null || true)
    if [[ "$code" =~ ^(200|400|405|406)$ ]]; then
      echo "Up ($code)."
      break
    fi
    if [[ "$i" -eq 30 ]]; then
      echo "Timeout waiting for $url"
      exit 1
    fi
    sleep 1
  done
done

fail=0
# The official servers isolate protocol/transport compatibility.
for url in http://127.0.0.1:3101/mcp http://127.0.0.1:3102/mcp; do
  echo ""
  echo "=== Node basic @ $url ==="
  MCP_SERVER_URL=$url pnpm exec tsx examples/node/basic-http.ts || fail=1
  echo "=== Browser entry basic @ $url ==="
  MCP_SERVER_URL=$url pnpm exec tsx examples/browser/basic-http.ts || fail=1
  echo "=== CommonJS @ $url ==="
  MCP_SERVER_URL=$url node examples/browser/commonjs/commonjs_example.cjs || fail=1
done

# The mcp-use servers exercise the full feature surface.
for example in \
  sampling-client \
  elicitation-client \
  notification-client \
  completion-client \
  capabilities-client; do
  echo ""
  echo "=== $example ==="
  timeout 20 pnpm exec tsx "examples/node/communication/$example.ts" || fail=1
done

echo ""
echo "=== OAuth ==="
timeout 15 pnpm exec tsx examples/node/auth/oauth-flow.ts || fail=1

echo ""
echo "=== Typecheck examples ==="
pnpm exec tsc -p examples/tsconfig.json || fail=1

echo ""
echo "=== Build React examples ==="
pnpm --dir examples/browser/react build || fail=1

exit $fail
