import { MCPServer, object, text } from "mcp-use/server";

// Create an MCP server for MCP Apps standard
const server = new MCPServer({
  name: "mcp-apps-server",
  version: "1.0.0",
  description: "MCP server with MCP Apps standard widgets",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

// Parse PORT with validation - fallback to 3000 if invalid
const parsedPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3000;

/**
 * ════════════════════════════════════════════════════════════════════
 * Task Manager Widget (MCP Apps)
 * ════════════════════════════════════════════════════════════════════
 *
 * This widget uses the MCP Apps standard:
 * - MIME type: text/html;profile=mcp-app
 * - Uses @modelcontextprotocol/ext-apps for host communication
 * - Works with MCP Apps compliant hosts
 *
 * The widget is defined in resources/task-manager/widget.tsx and uses
 * the useWidget hook with MCP Apps adaptor.
 *
 * Resource: ui://widget/task-manager-mcp.html
 */

/**
 * ════════════════════════════════════════════════════════════════════
 * Traditional MCP Tools
 * ════════════════════════════════════════════════════════════════════
 */

server.tool(
  {
    name: "get-widget-info",
    description: "Get information about available MCP Apps widgets",
  },
  async () => {
    const widgets = [
      {
        name: "task-manager",
        type: "mcpApp",
        mimeType: "text/html;profile=mcp-app",
        resource: "ui://widget/task-manager-mcp.html",
        tool: "task-manager",
      },
    ];

    return text(
      `Available MCP Apps Widgets:\n\n${widgets
        .map(
          (w) =>
            `📦 ${w.name}\n` +
            `  Type: ${w.type}\n` +
            `  MIME: ${w.mimeType}\n` +
            `  Tool: ${w.tool}\n` +
            `  Resource: ${w.resource}\n`
        )
        .join("\n")}\n` +
        `\nMCP Apps Standard:\n` +
        `• Uses @modelcontextprotocol/ext-apps for communication\n` +
        `• MIME type: text/html;profile=mcp-app\n` +
        `• Compatible with MCP Apps compliant hosts`
    );
  }
);

server.resource(
  {
    name: "server-config",
    uri: "config://server",
    title: "Server Configuration",
    description: "Current server configuration and status",
  },
  async () =>
    object({
      uri: "config://server",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          port: PORT,
          version: "1.0.0",
          standard: "MCP Apps",
          mimeType: "text/html;profile=mcp-app",
          widgets: {
            total: 1,
            list: ["task-manager"],
          },
          endpoints: {
            mcp: `http://localhost:${PORT}/mcp`,
            inspector: `http://localhost:${PORT}/inspector`,
            widgets: `http://localhost:${PORT}/mcp-use/widgets/`,
          },
        },
        null,
        2
      ),
    })
);

// Start the server
server.listen(PORT);

// Display helpful startup message
console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              🎨 MCP Apps Standard Server                      ║
╚═══════════════════════════════════════════════════════════════╝

Server is running on port ${PORT}

📍 Endpoints:
   MCP Protocol:  http://localhost:${PORT}/mcp
   Inspector UI:  http://localhost:${PORT}/inspector
   Widgets Base:  http://localhost:${PORT}/mcp-use/widgets/

🎯 Available Widgets:

   📦 task-manager
      Tool:      task-manager
      Resource:  ui://widget/task-manager-mcp.html
      MIME:      text/html;profile=mcp-app
      Browser:   http://localhost:${PORT}/mcp-use/widgets/task-manager

📋 MCP Apps Standard:
   • Uses @modelcontextprotocol/ext-apps
   • MIME type: text/html;profile=mcp-app
   • Compatible with MCP Apps compliant hosts

💡 Tip: Open the Inspector UI to test widgets interactively!
`);

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\nShutting down server...");
  process.exit(0);
});

export default server;
