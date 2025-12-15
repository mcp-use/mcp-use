#!/bin/bash
# Filesystem Server CLI Example
# This script demonstrates using the CLI client with the filesystem MCP server

set -e

echo "============================================"
echo "mcp-use CLI Client - Filesystem Example"
echo "============================================"
echo ""

# Create a temporary directory for testing
TEST_DIR=$(mktemp -d)
echo "Created test directory: $TEST_DIR"
echo ""

# Connect to filesystem server with stdio
echo "1. Connecting to filesystem MCP server (stdio)..."
npx mcp-use client connect --stdio "npx -y @modelcontextprotocol/server-filesystem $TEST_DIR" --name fs-example
echo ""

echo "2. Creating test files..."
echo "Hello from CLI example!" > "$TEST_DIR/test.txt"
echo '{"message": "JSON data"}' > "$TEST_DIR/data.json"
mkdir -p "$TEST_DIR/subdir"
echo "Nested file content" > "$TEST_DIR/subdir/nested.txt"
echo ""

echo "3. Listing directory contents..."
npx mcp-use client tools call list_directory "{\"path\": \"$TEST_DIR\"}"
echo ""

echo "4. Reading a file..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR/test.txt\"}"
echo ""

echo "5. Reading JSON file..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR/data.json\"}"
echo ""

echo "6. Writing a new file using the tool..."
npx mcp-use client tools call write_file "{\"path\": \"$TEST_DIR/created.txt\", \"content\": \"This file was created by the CLI!\"}"
echo ""

echo "7. Verifying the created file..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR/created.txt\"}"
echo ""

echo "8. Listing directory again (should include created.txt)..."
npx mcp-use client tools call list_directory "{\"path\": \"$TEST_DIR\"}"
echo ""

echo "9. Disconnecting..."
npx mcp-use client disconnect fs-example
echo ""

echo "10. Cleaning up test directory..."
rm -rf "$TEST_DIR"
echo ""

echo "============================================"
echo "Filesystem example completed!"
echo "============================================"
