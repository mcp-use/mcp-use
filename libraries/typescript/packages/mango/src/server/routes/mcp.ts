import { Hono } from "hono";
import { MCPClient } from "mcp-use";
import { getMcpSession } from "../mcp-helper.js";

export const mcpRoutes = new Hono();

// Store MCP connections in memory
const mcpConnections = new Map<
  string,
  { client: MCPClient; url: string; connectedAt: Date }
>();

/**
 * POST /api/mcp/connect
 * Connect to an MCP server
 */
mcpRoutes.post("/connect", async (c) => {
  try {
    const { projectName, url } = await c.req.json();

    if (!projectName || !url) {
      return c.json({ error: "projectName and url are required" }, 400);
    }

    // Check if already connected
    if (mcpConnections.has(projectName)) {
      return c.json({
        success: true,
        message: "Already connected",
        connection: {
          projectName,
          url: mcpConnections.get(projectName)?.url,
          alreadyConnected: true,
        },
      });
    }

    // Create MCP client
    const client = new MCPClient({
      mcpServers: {
        [projectName]: {
          url,
        },
      },
    });

    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Store connection
    mcpConnections.set(projectName, {
      client,
      url,
      connectedAt: new Date(),
    });

    return c.json({
      success: true,
      message: "Connected successfully",
      connection: {
        projectName,
        url,
        connectedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("MCP connect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/mcp/:projectName/primitives
 * Get tools, resources, and prompts from a connected server
 */
mcpRoutes.get("/:projectName/primitives", async (c) => {
  try {
    const projectName = c.req.param("projectName");
    const connection = mcpConnections.get(projectName);

    if (!connection) {
      return c.json({ error: "Not connected to this server" }, 404);
    }

    const { client } = connection;
    const session = await getMcpSession(client);

    const tools = await session.listTools();
    const resources = await session.listResources();
    const prompts = await session.listPrompts();

    return c.json({
      projectName,
      tools: Array.isArray(tools)
        ? tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }))
        : [],
      resources: Array.isArray(resources)
        ? resources.map((r: any) => ({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
          }))
        : [],
      prompts: Array.isArray(prompts)
        ? prompts.map((p: any) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments,
          }))
        : [],
    });
  } catch (error: any) {
    console.error("MCP primitives error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/mcp/:projectName/call-tool
 * Execute a tool on the connected server
 */
mcpRoutes.post("/:projectName/call-tool", async (c) => {
  try {
    const projectName = c.req.param("projectName");
    const { toolName, toolInput } = await c.req.json();

    if (!toolName) {
      return c.json({ error: "toolName is required" }, 400);
    }

    const connection = mcpConnections.get(projectName);
    if (!connection) {
      return c.json({ error: "Not connected to this server" }, 404);
    }

    const { client } = connection;
    const session = await getMcpSession(client);

    const result = await session.callTool(toolName, toolInput || {});

    return c.json({
      success: true,
      toolName,
      toolInput,
      result,
    });
  } catch (error: any) {
    console.error("MCP call-tool error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * DELETE /api/mcp/:projectName
 * Disconnect from an MCP server
 */
mcpRoutes.delete("/:projectName", async (c) => {
  try {
    const projectName = c.req.param("projectName");
    const connection = mcpConnections.get(projectName);

    if (!connection) {
      return c.json({ error: "Not connected to this server" }, 404);
    }

    // Remove connection
    mcpConnections.delete(projectName);

    return c.json({
      success: true,
      message: "Disconnected successfully",
      projectName,
    });
  } catch (error: any) {
    console.error("MCP disconnect error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/mcp/connections
 * List all active MCP connections
 */
mcpRoutes.get("/connections", async (c) => {
  const connections = Array.from(mcpConnections.entries()).map(
    ([name, conn]) => ({
      projectName: name,
      url: conn.url,
      connectedAt: conn.connectedAt.toISOString(),
    })
  );

  return c.json({ connections });
});
