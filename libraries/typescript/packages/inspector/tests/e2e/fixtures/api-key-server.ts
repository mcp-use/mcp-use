/**
 * API Key Authentication Test Server
 *
 * MCP server that requires API key authentication via Authorization header.
 * Valid API key: test-api-key-12345
 */

import { serve, type ServerType } from "@hono/node-server";
import { MCPServer } from "@mcp-use/server";
import { Hono } from "hono";
import { z } from "zod";

const VALID_API_KEY = "test-api-key-12345";

export function createApiKeyServer(port: number = 3003) {
  const server = new MCPServer({
    name: "ApiKeyTestServer",
    version: "1.0.0",
    description: "MCP server requiring API key authentication for testing",
    inspector: { enabled: false },
  });

  server.tool(
    {
      name: "verify_auth",
      description: "Verify that authentication is working",
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `Authentication successful! API key verified: ${VALID_API_KEY.substring(0, 10)}...`,
        },
      ],
    })
  );

  server.tool(
    {
      name: "echo",
      description: "Echo a message back",
      inputSchema: z.object({
        message: z.string(),
      }),
    },
    async ({ message }) => ({
      content: [{ type: "text", text: `Echo: ${message}` }],
    })
  );

  const app = new Hono();
  app.use("/mcp", async (c, next) => {
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

    await next();
  });
  const handler = server.getHandler();
  app.all("*", (c) => handler(c.req.raw));

  let httpServer: ServerType | undefined;

  return {
    async listen(listenPort = port) {
      return new Promise<{ port: number; url: string }>((resolve, reject) => {
        httpServer = serve(
          { fetch: app.fetch, port: listenPort, hostname: "127.0.0.1" },
          (info) => {
            resolve({
              port: info.port,
              url: `http://localhost:${info.port}/mcp`,
            });
          }
        );
        httpServer.on("error", reject);
      });
    },
    async close() {
      await server.close();
      if (httpServer) {
        await new Promise<void>((resolve, reject) => {
          httpServer!.close((err) => (err ? reject(err) : resolve()));
        });
        httpServer = undefined;
      }
    },
  };
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
