/**
 * MCP API Routes - Connect to dev MCP server and fetch primitives
 */
import { Hono } from "hono";
import { MCPClient } from "mcp-use";
import type { MCPSession } from "mcp-use";

const app = new Hono();

// Store MCP sessions by conversation ID
const mcpSessions = new Map<string, MCPSession>();

/**
 * Get or create an MCP session for a conversation
 */
async function getMcpSession(
  conversationId: string,
  devServerUrl: string
): Promise<MCPSession> {
  const existingSession = mcpSessions.get(conversationId);
  if (existingSession) {
    return existingSession;
  }

  // Create new client using config
  const client = MCPClient.fromDict({
    mcpServers: {
      dev: {
        url: devServerUrl,
      },
    },
  });

  // Create session to connect to the server
  const session = await client.createSession("dev");

  mcpSessions.set(conversationId, session);

  return session;
}

/**
 * GET /api/mcp/tools - List tools from dev server
 */
app.get("/tools", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const devServerUrl = c.req.query("devServerUrl");

    if (!conversationId || !devServerUrl) {
      return c.json(
        { error: "conversationId and devServerUrl are required" },
        400
      );
    }

    const session = await getMcpSession(conversationId, devServerUrl);
    const tools = await session.listTools();

    return c.json({ tools: tools.tools || [] });
  } catch (error: any) {
    console.error("Error fetching tools:", error);
    return c.json({ error: error.message || "Failed to fetch tools" }, 500);
  }
});

/**
 * GET /api/mcp/resources - List resources from dev server
 */
app.get("/resources", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const devServerUrl = c.req.query("devServerUrl");

    if (!conversationId || !devServerUrl) {
      return c.json(
        { error: "conversationId and devServerUrl are required" },
        400
      );
    }

    const session = await getMcpSession(conversationId, devServerUrl);
    const resources = await session.listResources();

    return c.json({ resources: resources.resources || [] });
  } catch (error: any) {
    console.error("Error fetching resources:", error);
    return c.json({ error: error.message || "Failed to fetch resources" }, 500);
  }
});

/**
 * GET /api/mcp/prompts - List prompts from dev server
 */
app.get("/prompts", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const devServerUrl = c.req.query("devServerUrl");

    if (!conversationId || !devServerUrl) {
      return c.json(
        { error: "conversationId and devServerUrl are required" },
        400
      );
    }

    const session = await getMcpSession(conversationId, devServerUrl);
    const prompts = await session.listPrompts();

    return c.json({ prompts: prompts.prompts || [] });
  } catch (error: any) {
    console.error("Error fetching prompts:", error);
    return c.json({ error: error.message || "Failed to fetch prompts" }, 500);
  }
});

/**
 * POST /api/mcp/tools/:name/call - Execute a tool
 */
app.post("/tools/:name/call", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const devServerUrl = c.req.query("devServerUrl");
    const toolName = c.req.param("name");
    const body = await c.req.json();

    if (!conversationId || !devServerUrl) {
      return c.json(
        { error: "conversationId and devServerUrl are required" },
        400
      );
    }

    const session = await getMcpSession(conversationId, devServerUrl);
    const result = await session.callTool(toolName, body.arguments || {});

    return c.json({ result });
  } catch (error: any) {
    console.error("Error calling tool:", error);
    return c.json({ error: error.message || "Failed to call tool" }, 500);
  }
});

/**
 * POST /api/mcp/resources/:uri/read - Read a resource
 */
app.post("/resources/read", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");
    const devServerUrl = c.req.query("devServerUrl");
    const body = await c.req.json();
    const uri = body.uri;

    if (!conversationId || !devServerUrl || !uri) {
      return c.json(
        { error: "conversationId, devServerUrl, and uri are required" },
        400
      );
    }

    const session = await getMcpSession(conversationId, devServerUrl);
    const result = await session.readResource(uri);

    return c.json({ result });
  } catch (error: any) {
    console.error("Error reading resource:", error);
    return c.json({ error: error.message || "Failed to read resource" }, 500);
  }
});

/**
 * POST /api/mcp/disconnect - Disconnect MCP client
 */
app.post("/disconnect", async (c) => {
  try {
    const conversationId = c.req.query("conversationId");

    if (!conversationId) {
      return c.json({ error: "conversationId is required" }, 400);
    }

    const session = mcpSessions.get(conversationId);
    if (session) {
      await session.close();
      mcpSessions.delete(conversationId);
    }

    return c.json({ success: true });
  } catch (error: any) {
    console.error("Error disconnecting:", error);
    return c.json({ error: error.message || "Failed to disconnect" }, 500);
  }
});

export default app;
