/**
 * API Key Authentication Test Server
 *
 * MCP server that requires API key authentication via Authorization header.
 * Valid API key: test-api-key-12345
 */

import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const VALID_API_KEY = "test-api-key-12345";

export function createApiKeyServer(port: number = 3003) {
  const server = new MCPServer({
    name: "ApiKeyTestServer",
    version: "1.0.0",
    description: "MCP server requiring API key authentication for testing",
  });

  // Custom middleware to check API key
  server.app.use("/mcp/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      c.header(
        "WWW-Authenticate",
        'Bearer realm="ApiKeyTestServer", error="missing_authorization"'
      );
      return c.json(
        {
          error: "Missing Authorization header",
          message:
            "API key required. Use: Authorization: Bearer test-api-key-12345",
        },
        401
      );
    }

    const [type, key] = authHeader.split(" ");
    if (type.toLowerCase() !== "bearer" || !key) {
      c.header(
        "WWW-Authenticate",
        'Bearer realm="ApiKeyTestServer", error="invalid_format"'
      );
      return c.json(
        {
          error: "Invalid Authorization header format",
          message: 'Expected format: "Bearer YOUR_API_KEY"',
        },
        401
      );
    }

    if (key !== VALID_API_KEY) {
      c.header(
        "WWW-Authenticate",
        'Bearer realm="ApiKeyTestServer", error="invalid_token"'
      );
      return c.json(
        {
          error: "Invalid API key",
          message: `Provided: ${key}, Expected: ${VALID_API_KEY}`,
        },
        401
      );
    }

    // Store API key in context for tools to access
    c.set("apiKey", key);
    await next();
  });

  // Tool to verify authenticated access
  server.tool(
    {
      name: "verify_auth",
      description: "Verify that authentication is working",
    },
    async (_args, ctx) => {
      const apiKey = (ctx as any).apiKey;
      return text(
        `Authentication successful! API key verified: ${apiKey?.substring(0, 10)}...`
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

export class ApiKeyServerHelper {
  private port: number;

  constructor(port: number = 3003) {
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

  getValidApiKey(): string {
    return VALID_API_KEY;
  }
}
