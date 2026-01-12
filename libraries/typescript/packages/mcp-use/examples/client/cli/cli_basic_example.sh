#!/bin/bash
# Basic CLI Client Example
# This script demonstrates basic usage of the mcp-use CLI client

set -e

echo "============================================"
echo "mcp-use CLI Client - Basic Example"
echo "============================================"
echo ""

# Note: This example assumes you have an MCP server running
# Start one with: npx mcp-use dev
# Or use a public MCP server

SERVER_URL="${MCP_SERVER_URL:-http://localhost:3000/mcp}"
SESSION_NAME="basic-example"

echo "1. Connecting to MCP server at $SERVER_URL..."
npx mcp-use client connect "$SERVER_URL" --name "$SESSION_NAME"
echo ""

echo "2. Listing available tools..."
npx mcp-use client tools list
echo ""

echo "3. Describing a tool (if available)..."
# Get first tool name and describe it
FIRST_TOOL=$(npx mcp-use client tools list --json | jq -r '.[0].name' 2>/dev/null || echo "")
if [ -n "$FIRST_TOOL" ]; then
  echo "Describing tool: $FIRST_TOOL"
  npx mcp-use client tools describe "$FIRST_TOOL"
else
  echo "No tools available to describe"
fi
echo ""

echo "4. Listing available resources..."
npx mcp-use client resources list || echo "No resources available or command failed"
echo ""

echo "5. Listing available prompts..."
npx mcp-use client prompts list || echo "No prompts available or command failed"
echo ""

echo "6. Showing all sessions..."
npx mcp-use client sessions list
echo ""

echo "7. Disconnecting..."
npx mcp-use client disconnect "$SESSION_NAME"
echo ""

echo "============================================"
echo "Example completed!"
echo "============================================"
