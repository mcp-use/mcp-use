/**
 * Custom Header Authentication Test Server
 *
 * MCP server that requires custom header authentication.
 * Valid header: X-Custom-Auth: custom-auth-token-xyz
 */

import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const CUSTOM_HEADER_NAME = "X-Custom-Auth";
const VALID_TOKEN = "custom-auth-token-xyz";

export function createCustomHeaderServer(port: number = 3004) {
  const server = new MCPServer({
    name: "CustomHeaderTestServer",
    version: "1.0.0",
    description:
      "MCP server requiring custom header authentication for testing",
  });

  // Custom middleware to check custom header
  server.app.use("/mcp/*", async (c, next) => {
    const customHeader = c.req.header(CUSTOM_HEADER_NAME);

    if (!customHeader) {
      return c.json(
        {
          error: "Missing required custom header",
          message: `Required header: ${CUSTOM_HEADER_NAME}: ${VALID_TOKEN}`,
          required_header: CUSTOM_HEADER_NAME,
        },
        401
      );
    }

    if (customHeader !== VALID_TOKEN) {
      return c.json(
        {
          error: "Invalid custom header value",
          message: `Provided: ${customHeader}, Expected: ${VALID_TOKEN}`,
          required_header: CUSTOM_HEADER_NAME,
        },
        401
      );
    }

    // Store token in context for tools to access
    c.set("customToken", customHeader);
    await next();
  });

  // Tool to verify authenticated access
  server.tool(
    {
      name: "verify_auth",
      description: "Verify that authentication is working",
    },
    async (_args, ctx) => {
      const token = (ctx as any).customToken;
      return text(
        `Authentication successful! Custom header verified: ${token?.substring(0, 15)}...`
      );
    }
  );

  // Simple echo tool
  server.tool(
    {
      name: "echo",
      description: "Echo a message back",
      schema: z.object({
        message: z.string(),
      }),
    },
    async ({ message }) => text(`Echo: ${message}`)
  );

  return server;
}

export class CustomHeaderServerHelper {
  private port: number;

  constructor(port: number = 3004) {
    this.port = port;
  }

  getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getMcpUrl(): string {
    return `http://localhost:${this.port}/mcp`;
  }

  getPort(): number {
    return this.port;
  }

  getHeaderName(): string {
    return CUSTOM_HEADER_NAME;
  }

  getValidToken(): string {
    return VALID_TOKEN;
  }
}
