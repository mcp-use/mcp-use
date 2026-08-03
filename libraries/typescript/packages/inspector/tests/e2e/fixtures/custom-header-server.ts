/**
 * Custom Header Authentication Test Server
 *
 * MCP server that requires custom header authentication.
 * Valid header: X-Custom-Auth: custom-auth-token-xyz
 */

import { serve, type ServerType } from "@hono/node-server";
import { MCPServer } from "mcp-use";
import { Hono } from "hono";
import { z } from "zod";

const CUSTOM_HEADER_NAME = "X-Custom-Auth";
const VALID_TOKEN = "custom-auth-token-xyz";

export function createCustomHeaderServer(port: number = 3004) {
  const server = new MCPServer({
    name: "CustomHeaderTestServer",
    version: "1.0.0",
    description:
      "MCP server requiring custom header authentication for testing",
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
          text: `Authentication successful! Custom header verified: ${VALID_TOKEN.substring(0, 15)}...`,
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

    await next();
  });
  app.mount("/", server.fetch);

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
