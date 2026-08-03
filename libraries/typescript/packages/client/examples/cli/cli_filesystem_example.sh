#!/bin/bash
# Filesystem Server CLI Example (stdio).
# Self-contained — spins up @modelcontextprotocol/server-filesystem.

set -euo pipefail

echo "============================================"
echo "mcp-use CLI Client - Filesystem Example"
echo "============================================"
echo ""

CLI="${MCP_USE_CLI:-mcp-use}"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"; $CLI client remove fs-example >/dev/null 2>&1 || true' EXIT

echo "Created test directory: $TEST_DIR"
echo ""

echo "1. Connecting to filesystem MCP server (stdio)..."
$CLI client connect fs-example --stdio "npx -y @modelcontextprotocol/server-filesystem $TEST_DIR" --no-oauth
echo ""

echo "2. Creating test files..."
echo "Hello from CLI example!" > "$TEST_DIR/test.txt"
echo '{"message": "JSON data"}' > "$TEST_DIR/data.json"
mkdir -p "$TEST_DIR/subdir"
echo "Nested file content" > "$TEST_DIR/subdir/nested.txt"
echo ""

echo "3. Listing directory contents..."
$CLI client fs-example tools call list_directory "{\"path\": \"$TEST_DIR\"}"
echo ""

echo "4. Reading a file..."
$CLI client fs-example tools call read_text_file "{\"path\": \"$TEST_DIR/test.txt\"}"
echo ""

echo "5. Reading JSON file..."
$CLI client fs-example tools call read_text_file "{\"path\": \"$TEST_DIR/data.json\"}"
echo ""

echo "6. Writing a new file using the tool..."
$CLI client fs-example tools call write_file "{\"path\": \"$TEST_DIR/created.txt\", \"content\": \"This file was created by the CLI!\"}"
echo ""

echo "7. Verifying the created file..."
$CLI client fs-example tools call read_text_file "{\"path\": \"$TEST_DIR/created.txt\"}"
echo ""

echo "8. Listing directory again (should include created.txt)..."
$CLI client fs-example tools call list_directory "{\"path\": \"$TEST_DIR\"}"
echo ""

echo "9. Removing saved server..."
$CLI client remove fs-example
echo ""

echo "============================================"
echo "Filesystem example completed!"
echo "============================================"
