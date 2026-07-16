#!/bin/bash
# CLI scripting against the demo HTTP servers (jq required).
#
#   cd ../_demo-servers && PORT=3102 pnpm v2
#   MCP_SERVER_URL=http://127.0.0.1:3102/mcp ./cli_scripting_example.sh

set -euo pipefail

echo "============================================"
echo "mcp-use CLI Client - Scripting Example"
echo "============================================"
echo ""

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required for this example"
  echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
  exit 1
fi

CLI="${MCP_USE_CLI:-mcp-use}"
SERVER_URL="${MCP_SERVER_URL:-http://127.0.0.1:3102/mcp}"
NAME="script-demo"

cleanup() {
  $CLI client remove "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Connecting to $SERVER_URL as '$NAME'..."
$CLI client connect "$NAME" "$SERVER_URL" --no-oauth >/dev/null
echo ""

echo "Example 1: List tools as JSON"
echo "-----------------------------"
TOOLS=$($CLI client "$NAME" tools list --json 2>/dev/null)
echo "$TOOLS" | jq -r '.[].name'
TOOL_COUNT=$(echo "$TOOLS" | jq 'length')
echo "Count: $TOOL_COUNT"
echo ""

echo "Example 2: Call echo and parse content"
echo "--------------------------------------"
ECHO=$($CLI client "$NAME" tools call echo '{"message":"scripted"}' --json 2>/dev/null)
echo "$ECHO" | jq -r '.content[0].text // .content'
echo ""

echo "Example 3: Call add and extract result text"
echo "-------------------------------------------"
ADD=$($CLI client "$NAME" tools call add '{"a":20,"b":22}' --json 2>/dev/null)
echo "$ADD" | jq -r '.content[0].text // .content'
echo ""

echo "Example 4: Conditional on tool presence"
echo "---------------------------------------"
if echo "$TOOLS" | jq -e 'map(.name) | index("echo")' >/dev/null; then
  echo "✓ echo tool present"
else
  echo "✗ echo tool missing"
  exit 1
fi
echo ""

$CLI client remove "$NAME" >/dev/null
echo "============================================"
echo "Scripting example completed!"
echo "============================================"
