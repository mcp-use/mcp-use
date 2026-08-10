import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

type AppEnv = {
  Variables: {
    tenantId: string;
  };
};

describe("Hono HTTP integration", () => {
  let server: MCPServer<never, AppEnv> | undefined;

  afterEach(async () => {
    await server?.close();
  });

  it("keeps the v1 getHandler alias without another serving path", () => {
    server = new MCPServer<never, AppEnv>({
      name: "hono-handler-alias",
      version: "1.0.0",
    });

    expect(server.getHandler()).toBe(server.fetch);
  });

  it("shares HTTP middleware state with custom routes and MCP callbacks", async () => {
    server = new MCPServer<never, AppEnv>({
      name: "hono-integration",
      version: "1.0.0",
    });

    server.use("*", async (context, next) => {
      context.set("tenantId", "acme");
      await next();
      context.header("x-http-middleware", "ran");
    });

    server.get("/health", (context) =>
      context.json({ ok: true, tenantId: context.get("tenantId") })
    );

    server.tool(
      {
        name: "request-context",
        inputSchema: z.object({}),
      },
      async (_input, context) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tenantId: context.get("tenantId"),
              aliasMatches: context.request === context.req,
              method: context.request?.method,
              pathname: context.request
                ? new URL(context.request.raw.url).pathname
                : undefined,
            }),
          },
        ],
      })
    );

    const listener = await server.listen(0);
    const health = await fetch(new URL("/health", listener.url));
    expect(await health.json()).toEqual({ ok: true, tenantId: "acme" });
    expect(health.headers.get("x-http-middleware")).toBe("ran");

    const transport = new StreamableHTTPClientTransport(new URL(listener.url));
    const client = new Client({ name: "hono-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "request-context",
        arguments: {},
      });
      const text = result.content.find((block) => block.type === "text");
      expect(text?.type === "text" ? JSON.parse(text.text) : undefined).toEqual(
        {
          tenantId: "acme",
          aliasMatches: true,
          method: "POST",
          pathname: "/mcp",
        }
      );
    } finally {
      await client.close();
    }
  });
});
