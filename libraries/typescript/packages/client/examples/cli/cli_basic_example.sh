#!/bin/bash
# Basic CLI Client Example — works against the official-SDK demo servers.
#
#   cd ../_demo-servers && PORT=3101 pnpm v1   # or PORT=3102 pnpm v2
#   MCP_SERVER_URL=http://127.0.0.1:3101/mcp ./cli_basic_example.sh

set -euo pipefail

echo "============================================"
echo "mcp-use CLI Client - Basic Example"
echo "============================================"
echo ""

SERVER_URL="${MCP_SERVER_URL:-http://127.0.0.1:3102/mcp}"
SESSION_NAME="${SESSION_NAME:-basic-example}"
CLI="${MCP_USE_CLI:-mcp-use}"

echo "1. Connecting to MCP server at $SERVER_URL as '$SESSION_NAME'..."
$CLI client connect "$SESSION_NAME" "$SERVER_URL" --no-oauth
echo ""

echo "2. Listing available tools..."
$CLI client "$SESSION_NAME" tools list
echo ""

echo "3. Calling echo..."
$CLI client "$SESSION_NAME" tools call echo '{"message":"cli-basic"}'
echo ""

echo "4. Calling add..."
$CLI client "$SESSION_NAME" tools call add '{"a":20,"b":22}'
echo ""

echo "5. Listing saved servers..."
$CLI client list
echo ""

echo "6. Removing saved server..."
$CLI client remove "$SESSION_NAME"
echo ""

echo "============================================"
echo "Example completed!"
echo "============================================"
