#!/bin/bash
# Multi-server CLI example — two saved HTTP demos (or two stdio filesystem roots).
#
# Default: both official-SDK demos (start them first):
#   cd ../_demo-servers && PORT=3101 pnpm v1 & PORT=3102 pnpm v2 &
#   ./cli_multi_session_example.sh

set -euo pipefail

echo "============================================"
echo "mcp-use CLI Client - Multi-Server Example"
echo "============================================"
echo ""

CLI="${MCP_USE_CLI:-mcp-use}"
URL_A="${MCP_SERVER_URL_A:-http://127.0.0.1:3101/mcp}"
URL_B="${MCP_SERVER_URL_B:-http://127.0.0.1:3102/mcp}"

cleanup() {
  $CLI client remove multi-a >/dev/null 2>&1 || true
  $CLI client remove multi-b >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1. Connecting to server A ($URL_A)..."
$CLI client connect multi-a "$URL_A" --no-oauth
echo ""

echo "2. Connecting to server B ($URL_B)..."
$CLI client connect multi-b "$URL_B" --no-oauth
echo ""

echo "3. Listing saved servers..."
$CLI client list
echo ""

echo "4. Tools on A..."
$CLI client multi-a tools list
echo ""

echo "5. Tools on B..."
$CLI client multi-b tools list
echo ""

echo "6. Call echo on A..."
$CLI client multi-a tools call echo '{"message":"from-a"}'
echo ""

echo "7. Call echo on B..."
$CLI client multi-b tools call echo '{"message":"from-b"}'
echo ""

echo "8. Removing both..."
$CLI client remove multi-a
$CLI client remove multi-b
echo ""

echo "============================================"
echo "Multi-server example completed!"
echo "============================================"
