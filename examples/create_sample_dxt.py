#!/usr/bin/env python3
"""
Create a sample DXT file for testing DXT support in mcp-use.

This script creates a simple DXT extension that demonstrates
the DXT format and can be used for testing.
"""

import json
import zipfile
from pathlib import Path


def create_sample_dxt():
    """Create a sample DXT file for testing."""

    # Sample manifest for a simple MCP server
    manifest = {
        "dxt_version": "0.1",
        "name": "sample-filesystem-server",
        "display_name": "Sample Filesystem Server",
        "version": "1.0.0",
        "description": "A sample MCP server for filesystem operations",
        "author": {"name": "mcp-use team", "email": "support@mcp-use.com"},
        "server": {
            "type": "node",
            "entry_point": "server/index.js",
            "mcp_config": {
                "command": "node",
                "args": ["${__dirname}/server/index.js"],
                "env": {"ALLOWED_DIRECTORY": "${user_config.allowed_directory}"},
            },
        },
        "user_config": {
            "allowed_directory": {
                "type": "string",
                "title": "Allowed Directory",
                "description": "The directory path that the server is allowed to access",
                "required": True,
            }
        },
        "tools": [
            {"name": "read_file", "description": "Read the contents of a file"},
            {"name": "write_file", "description": "Write contents to a file"},
            {"name": "list_directory", "description": "List files and directories"},
        ],
    }

    # Sample server implementation (simplified)
    server_code = """#!/usr/bin/env node
/**
 * Sample MCP Filesystem Server
 * This is a simplified example MCP server for demonstration.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const fs = require('fs').promises;
const path = require('path');

// Get allowed directory from environment
const ALLOWED_DIRECTORY = process.env.ALLOWED_DIRECTORY || process.cwd();

const server = new Server(
  {
    name: 'sample-filesystem-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool implementations
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to read',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write contents to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to write',
            },
            content: {
              type: 'string',
              description: 'Content to write to the file',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List files and directories',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the directory to list',
            },
          },
          required: ['path'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'read_file': {
      const filePath = path.resolve(ALLOWED_DIRECTORY, args.path);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to read file: ${error.message}`);
      }
    }

    case 'write_file': {
      const filePath = path.resolve(ALLOWED_DIRECTORY, args.path);
      try {
        await fs.writeFile(filePath, args.content, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: `Successfully wrote to ${args.path}`,
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to write file: ${error.message}`);
      }
    }

    case 'list_directory': {
      const dirPath = path.resolve(ALLOWED_DIRECTORY, args.path);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const formatted = entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to list directory: ${error.message}`);
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sample MCP Filesystem Server running on stdio');
}

main().catch(console.error);
"""

    # Package.json for the server
    package_json = {
        "name": "sample-filesystem-server",
        "version": "1.0.0",
        "description": "Sample MCP filesystem server",
        "main": "index.js",
        "dependencies": {"@modelcontextprotocol/sdk": "^0.5.0"},
        "engines": {"node": ">=18"},
    }

    # Create the DXT file
    dxt_path = Path("sample-filesystem-server.dxt")

    print(f"🏗️  Creating sample DXT file: {dxt_path}")

    with zipfile.ZipFile(dxt_path, "w", zipfile.ZIP_DEFLATED) as dxt_file:
        # Add manifest
        dxt_file.writestr("manifest.json", json.dumps(manifest, indent=2))

        # Add server code
        dxt_file.writestr("server/index.js", server_code)

        # Add package.json
        dxt_file.writestr("server/package.json", json.dumps(package_json, indent=2))

        # Add a README
        readme_content = """# Sample Filesystem Server DXT

This is a sample DXT (Desktop Extension) file containing a simple MCP filesystem server.

## Configuration Required

- `allowed_directory`: The directory path that the server is allowed to access

## Tools Provided

- `read_file`: Read the contents of a file
- `write_file`: Write contents to a file
- `list_directory`: List files and directories

## Usage with mcp-use

```python
from mcp_use import MCPClient

# Load DXT with user configuration
client = MCPClient.from_dxt_file(
    "sample-filesystem-server.dxt",
    user_config={"allowed_directory": "/path/to/safe/directory"}
)
```

Note: This is a simplified example for demonstration purposes.
A real MCP server would need proper error handling, security checks, and more robust implementation.
"""
        dxt_file.writestr("README.md", readme_content)

    print(f"✅ Created sample DXT file: {dxt_path.absolute()}")
    print(f"📁 File size: {dxt_path.stat().st_size} bytes")

    # Show how to use it
    print("\n🚀 Usage example:")
    print("```python")
    print("from mcp_use import MCPClient")
    print("")
    print("# Load the DXT file")
    print("client = MCPClient.from_dxt_file(")
    print("    'sample-filesystem-server.dxt',")
    print("    user_config={'allowed_directory': '/path/to/safe/directory'}")
    print(")")
    print("```")

    return dxt_path


if __name__ == "__main__":
    create_sample_dxt()
