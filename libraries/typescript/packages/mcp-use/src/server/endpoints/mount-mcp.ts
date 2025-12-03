/**
 * MCP Endpoint Mounting
 *
 * Main orchestration function for mounting MCP endpoints at /mcp and /sse.
 */

import type { Hono as HonoType } from "hono";
import {
  type SessionData,
  getTransportConfig,
  getOrCreateTransport as getOrCreateTransportHelper,
  startIdleCleanup,
} from "../sessions/index.js";
import type { ServerConfig } from "../types/index.js";
import { handlePostRequest } from "./post-handler.js";
import { handleGetRequest } from "./get-handler.js";
import { handleDeleteRequest } from "./delete-handler.js";

/**
 * Mount MCP server endpoints at /mcp and /sse
 *
 * Sets up the HTTP transport layer for the MCP server, creating endpoints for
 * Server-Sent Events (SSE) streaming, POST message handling, and DELETE session cleanup.
 */
export async function mountMcp(
  app: HonoType,
  server: any,
  sessions: Map<string, SessionData>,
  config: ServerConfig,
  isProductionMode: boolean
): Promise<{ mcpMounted: boolean; idleCleanupInterval?: NodeJS.Timeout }> {
  const { StreamableHTTPServerTransport } =
    await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const idleTimeoutMs = config.sessionIdleTimeoutMs ?? 300000; // Default: 5 minutes

  // Get transport configuration
  const transportConfig = getTransportConfig(config, isProductionMode);

  // Helper to get or create a transport for a session
  const getOrCreateTransport = async (
    sessionId?: string,
    isInit = false
  ): Promise<InstanceType<typeof StreamableHTTPServerTransport> | null> => {
    return await getOrCreateTransportHelper(
      StreamableHTTPServerTransport,
      server,
      sessions,
      transportConfig,
      config,
      sessionId,
      isInit
    );
  };

  // Start idle cleanup interval if timeout is configured
  let idleCleanupInterval: NodeJS.Timeout | undefined;
  if (idleTimeoutMs > 0) {
    idleCleanupInterval = startIdleCleanup(sessions, idleTimeoutMs);
  }

  // Helper function to mount endpoints for a given path
  const mountEndpoint = (endpoint: string) => {
    // POST endpoint for messages
    app.post(endpoint, async (c) => {
      return await handlePostRequest(c, sessions, getOrCreateTransport);
    });

    // GET endpoint for SSE streaming
    app.get(endpoint, async (c) => {
      return await handleGetRequest(c, sessions, getOrCreateTransport);
    });

    // DELETE endpoint for session cleanup
    app.delete(endpoint, async (c) => {
      return await handleDeleteRequest(c, sessions, getOrCreateTransport);
    });
  };

  // Mount endpoints for both /mcp and /sse
  mountEndpoint("/mcp");
  mountEndpoint("/sse");

  console.log(`[MCP] Server mounted at /mcp and /sse`);

  return { mcpMounted: true, idleCleanupInterval };
}
