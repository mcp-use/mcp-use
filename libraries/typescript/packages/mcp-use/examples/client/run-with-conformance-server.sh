#!/usr/bin/env bash
# Start conformance server, run Node and Browser full-features examples, then stop server.
# Run from mcp-use package root (libraries/typescript/packages/mcp-use).
# Exit 0 only if both examples succeed.

set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

cleanup() {
  echo "Stopping conformance server..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting conformance server on port 3000..."
(cd examples/server/features/conformance && PORT=3000 npx tsx src/server.ts) &

echo "Waiting for http://localhost:3000/mcp ..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:3000/mcp 2>/dev/null | grep -q '200\|401\|405'; then
    echo "Server is up."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Timeout: server did not become ready."
    exit 1
  fi
  sleep 1
done

echo ""
echo "Running Node full-features example..."
npx tsx examples/client/node/full-features-example.ts
NODE_EXIT=$?

echo ""
echo "Running Browser full-features example..."
npx tsx examples/client/browser/full-features-example.ts
BROWSER_EXIT=$?

if [ "$NODE_EXIT" -ne 0 ] || [ "$BROWSER_EXIT" -ne 0 ]; then
  echo "Node exit: $NODE_EXIT, Browser exit: $BROWSER_EXIT"
  exit 1
fi
echo ""
echo "Both examples completed successfully."
exit 0
