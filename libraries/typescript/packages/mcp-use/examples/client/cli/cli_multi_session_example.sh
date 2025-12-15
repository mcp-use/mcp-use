#!/bin/bash
# Multi-Session CLI Example
# This script demonstrates managing multiple MCP server sessions

set -e

echo "============================================"
echo "mcp-use CLI Client - Multi-Session Example"
echo "============================================"
echo ""

# Create test directories for multiple filesystem servers
TEST_DIR1=$(mktemp -d)
TEST_DIR2=$(mktemp -d)
echo "Created test directories:"
echo "  DIR1: $TEST_DIR1"
echo "  DIR2: $TEST_DIR2"
echo ""

# Setup test files
echo "Setting up test files..."
echo "Content from server 1" > "$TEST_DIR1/server1.txt"
echo "Content from server 2" > "$TEST_DIR2/server2.txt"
echo ""

# Connect to first filesystem server
echo "1. Connecting to first filesystem server..."
npx mcp-use client connect --stdio "npx -y @modelcontextprotocol/server-filesystem $TEST_DIR1" --name fs-server-1
echo ""

# Connect to second filesystem server
echo "2. Connecting to second filesystem server..."
npx mcp-use client connect --stdio "npx -y @modelcontextprotocol/server-filesystem $TEST_DIR2" --name fs-server-2
echo ""

# List all sessions
echo "3. Listing all active sessions..."
npx mcp-use client sessions list
echo ""

# Use first server
echo "4. Reading file from first server (active session)..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR1/server1.txt\"}"
echo ""

# Switch to second server
echo "5. Switching to second server..."
npx mcp-use client sessions switch fs-server-2
echo ""

# Use second server
echo "6. Reading file from second server (now active)..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR2/server2.txt\"}"
echo ""

# Use first server explicitly without switching
echo "7. Reading from first server using --session flag..."
npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR1/server1.txt\"}" --session fs-server-1
echo ""

# Show sessions again
echo "8. Showing sessions (fs-server-2 should be active)..."
npx mcp-use client sessions list
echo ""

# Disconnect all
echo "9. Disconnecting all sessions..."
npx mcp-use client disconnect --all
echo ""

# Cleanup
echo "10. Cleaning up test directories..."
rm -rf "$TEST_DIR1" "$TEST_DIR2"
echo ""

echo "============================================"
echo "Multi-session example completed!"
echo "============================================"
