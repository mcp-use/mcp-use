#!/bin/bash
# CLI Scripting Example
# This script demonstrates using the CLI client in automation scripts

set -e

echo "============================================"
echo "mcp-use CLI Client - Scripting Example"
echo "============================================"
echo ""

# Check dependencies
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required for this example"
  echo "Install with: brew install jq (macOS) or apt install jq (Linux)"
  exit 1
fi

# Create test directory
TEST_DIR=$(mktemp -d)
echo "Test directory: $TEST_DIR"
echo ""

# Setup test data
echo "Setting up test data..."
cat > "$TEST_DIR/config.json" << 'EOF'
{
  "app": "my-app",
  "version": "1.0.0",
  "settings": {
    "debug": false,
    "port": 3000
  }
}
EOF

cat > "$TEST_DIR/data.txt" << 'EOF'
Item 1: Apple
Item 2: Banana
Item 3: Cherry
EOF
echo ""

# Connect to filesystem server
echo "Connecting to MCP server..."
npx mcp-use client connect --stdio "npx -y @modelcontextprotocol/server-filesystem $TEST_DIR" --name script-session > /dev/null 2>&1
echo ""

# Example 1: Extract specific data from JSON
echo "Example 1: Reading and parsing JSON config"
echo "-------------------------------------------"
CONFIG=$(npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR/config.json\"}" --json 2>/dev/null)
APP_NAME=$(echo "$CONFIG" | jq -r '.content[0].text' | jq -r '.app')
VERSION=$(echo "$CONFIG" | jq -r '.content[0].text' | jq -r '.version')
echo "App: $APP_NAME"
echo "Version: $VERSION"
echo ""

# Example 2: Count lines in a file
echo "Example 2: Counting lines in a file"
echo "------------------------------------"
CONTENT=$(npx mcp-use client tools call read_file "{\"path\": \"$TEST_DIR/data.txt\"}" --json 2>/dev/null)
LINE_COUNT=$(echo "$CONTENT" | jq -r '.content[0].text' | wc -l | tr -d ' ')
echo "Lines in data.txt: $LINE_COUNT"
echo ""

# Example 3: List and filter files
echo "Example 3: Listing and filtering files"
echo "---------------------------------------"
FILES=$(npx mcp-use client tools call list_directory "{\"path\": \"$TEST_DIR\"}" --json 2>/dev/null)
JSON_FILES=$(echo "$FILES" | jq -r '.content[0].text' | grep -c '\.json' || echo "0")
TXT_FILES=$(echo "$FILES" | jq -r '.content[0].text' | grep -c '\.txt' || echo "0")
echo "JSON files: $JSON_FILES"
echo "Text files: $TXT_FILES"
echo ""

# Example 4: Generate a report file
echo "Example 4: Generating a report"
echo "-------------------------------"
REPORT="Report Generated: $(date)\n\n"
REPORT+="Configuration:\n"
REPORT+="  App: $APP_NAME\n"
REPORT+="  Version: $VERSION\n\n"
REPORT+="Files:\n"
REPORT+="  JSON: $JSON_FILES\n"
REPORT+="  Text: $TXT_FILES\n"
REPORT+="  Lines in data.txt: $LINE_COUNT\n"

# Write report using MCP tool
REPORT_JSON=$(jq -n --arg path "$TEST_DIR/report.txt" --arg content "$REPORT" '{path: $path, content: $content}')
npx mcp-use client tools call write_file "$REPORT_JSON" > /dev/null 2>&1
echo "Report written to: $TEST_DIR/report.txt"
echo ""

# Show the report
echo "Report contents:"
echo "----------------"
cat "$TEST_DIR/report.txt"
echo ""

# Example 5: Conditional logic based on tool results
echo "Example 5: Conditional execution"
echo "---------------------------------"
if [ "$JSON_FILES" -gt 0 ]; then
  echo "✓ JSON files found - processing..."
  # Could do more processing here
else
  echo "✗ No JSON files found - skipping processing"
fi
echo ""

# Cleanup
echo "Cleaning up..."
npx mcp-use client disconnect script-session > /dev/null 2>&1
rm -rf "$TEST_DIR"
echo ""

echo "============================================"
echo "Scripting example completed!"
echo "============================================"
echo ""
echo "Key takeaways:"
echo "  • Use --json flag for machine-readable output"
echo "  • Pipe results through jq for JSON processing"
echo "  • Redirect stderr (2>/dev/null) to suppress logs"
echo "  • Use exit codes for error handling"
echo "  • Combine with standard Unix tools"
