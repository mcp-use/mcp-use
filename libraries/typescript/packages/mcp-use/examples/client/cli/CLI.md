# CLI Client Examples

This directory contains examples demonstrating how to use the mcp-use CLI client.

## Overview

The mcp-use CLI client allows you to interact with MCP servers directly from the terminal without writing any code. It's perfect for:

- Testing and debugging MCP servers
- Exploring server capabilities
- Automating tasks with shell scripts
- Quick prototyping and experimentation

## Quick Start

```bash
# Connect to an MCP server
npx mcp-use client connect http://localhost:3000/mcp --name my-server

# List available tools
npx mcp-use client tools list

# Call a tool
npx mcp-use client tools call tool_name '{"param": "value"}'

# Start interactive mode
npx mcp-use client interactive
```

## Shell Script Examples

### 1. Basic Example (`cli_basic_example.sh`)

Demonstrates the fundamental CLI operations:
- Connecting to a server
- Listing tools, resources, and prompts
- Managing sessions
- Disconnecting

**Usage:**
```bash
# With a running MCP server
MCP_SERVER_URL=http://localhost:3000/mcp ./cli_basic_example.sh
```

### 2. Filesystem Example (`cli_filesystem_example.sh`)

Shows how to work with the filesystem MCP server:
- Connecting to stdio-based servers
- Reading and writing files
- Listing directories
- Creating and verifying file operations

**Usage:**
```bash
./cli_filesystem_example.sh
```

This example is self-contained and doesn't require a running server.

### 3. Multi-Session Example (`cli_multi_session_example.sh`)

Demonstrates managing multiple MCP sessions:
- Connecting to multiple servers simultaneously
- Switching between sessions
- Using the `--session` flag to target specific servers
- Managing session state

**Usage:**
```bash
./cli_multi_session_example.sh
```

### 4. Scripting Example (`cli_scripting_example.sh`)

Shows how to use the CLI in automation scripts:
- Processing JSON output with `jq`
- Extracting specific data from responses
- Conditional logic based on tool results
- Generating reports
- Error handling and cleanup

**Requirements:**
- `jq` for JSON processing

**Usage:**
```bash
# Install jq first
brew install jq  # macOS
# or
apt install jq   # Linux

# Run the example
./cli_scripting_example.sh
```

## Interactive Mode

For exploration and testing, use interactive mode:

```bash
npx mcp-use client interactive
```

Available commands in interactive mode:
- `tools list` - List available tools
- `tools call <name>` - Call a tool
- `tools describe <name>` - Show tool details
- `resources list` - List resources
- `resources read <uri>` - Read a resource
- `prompts list` - List prompts
- `prompts get <name>` - Get a prompt
- `sessions list` - List sessions
- `exit` - Exit interactive mode

## Common Patterns

### Testing a Tool

```bash
# 1. Describe the tool to see its schema
npx mcp-use client tools describe my_tool

# 2. Call it with test data
npx mcp-use client tools call my_tool '{"param": "test"}'

# 3. Check the output
npx mcp-use client tools call my_tool '{"param": "test"}' --json | jq
```

### Working with Resources

```bash
# List available resources
npx mcp-use client resources list

# Read a specific resource
npx mcp-use client resources read "file:///path/to/resource"

# Subscribe to updates (keeps running)
npx mcp-use client resources subscribe "file:///path/to/resource"
```

### Automation Scripts

```bash
#!/bin/bash

# Connect
npx mcp-use client connect <url> --name automation

# Get data as JSON
RESULT=$(npx mcp-use client tools call get_data '{}' --json 2>/dev/null)

# Process with jq
VALUE=$(echo "$RESULT" | jq -r '.content[0].text')

# Use in your script
echo "Retrieved value: $VALUE"

# Cleanup
npx mcp-use client disconnect automation
```

## Tips

1. **Use `--json` for scripting**: Makes output machine-readable
2. **Redirect stderr**: Use `2>/dev/null` to hide logs in scripts
3. **Named sessions**: Always use `--name` for easier session management
4. **Session persistence**: Sessions are saved in `~/.mcp-use/cli-sessions.json`
5. **Multiple terminals**: You can work with different sessions in different terminals

## Troubleshooting

### "No active session" error

Connect to a server first:
```bash
npx mcp-use client connect <url> --name session-name
```

### "Tool not found" error

List available tools:
```bash
npx mcp-use client tools list
```

### Connection refused

Check that:
- The server is running
- The URL is correct
- Firewall allows the connection

## Next Steps

- Read the full [CLI Client documentation](/docs/typescript/client/cli.mdx)
- Explore [MCP Server examples](/examples/server/)
- Learn about [MCP Agents](/docs/typescript/agent/)
