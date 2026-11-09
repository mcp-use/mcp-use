import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer, type SecurityAuditEvent } from "../src/index.js";

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const item = result.content.find(
    (block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string"
  );
  if (item === undefined) throw new Error("No text content in result");
  return item.text;
}

describe("runtime tool security", () => {
  let server: MCPServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const events: SecurityAuditEvent[] = [];
  const calls: string[] = [];
  let shortCircuit = false;

  beforeAll(async () => {
    server = new MCPServer({
      name: "security-test-server",
      version: "1.0.0",
      skills: false,
      security: {
        policy: async ({ tool, arguments: args }) => ({
          allowed: tool.name !== "blocked" && args["allow"] !== false,
          reason: "blocked by test policy",
        }),
        audit: (event) => {
          events.push(event);
        },
        redactArguments: (args) => ({ toolInput: Object.keys(args) }),
      },
    });

    server.use("mcp:tools/call", async (_ctx, next) => {
      if (shortCircuit) {
        return {
          content: [{ type: "text" as const, text: "short-circuited" }],
        };
      }
      return next();
    });

    server.tool(
      {
        name: "echo",
        inputSchema: z.object({
          message: z.string(),
          allow: z.boolean().optional(),
        }),
      },
      async ({ message }) => {
        calls.push(message);
        return { content: [{ type: "text", text: message }] };
      }
    );
    server.tool({ name: "blocked", inputSchema: z.object({}) }, async () => {
      calls.push("blocked");
      return { content: [{ type: "text", text: "should not run" }] };
    });

    server.__primeSkills(undefined);
    const { url } = await server.listen(0);
    transport = new StreamableHTTPClientTransport(new URL(url));
    client = new Client({ name: "security-test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
    await server.close();
  });

  it("allows policy-approved calls and records their lifecycle", async () => {
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hello" },
    });

    expect(textContent(result)).toBe("hello");
    expect(calls).toEqual(["hello"]);
    expect(events.map(({ phase }) => phase)).toEqual([
      "requested",
      "completed",
    ]);
    expect(events[0]?.arguments).toEqual({ toolInput: ["message"] });
  });

  it("denies calls before the tool callback runs", async () => {
    const result = await client.callTool({ name: "blocked", arguments: {} });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("blocked by test policy");
    expect(calls).not.toContain("blocked");
    expect(events.slice(-2).map(({ phase }) => phase)).toEqual([
      "requested",
      "denied",
    ]);
  });

  it("keeps concurrent policy evaluations isolated", async () => {
    const results = await Promise.all([
      client.callTool({ name: "echo", arguments: { message: "one" } }),
      client.callTool({ name: "echo", arguments: { message: "two" } }),
    ]);

    expect(results.map(textContent)).toEqual(["one", "two"]);
    expect([...calls].sort()).toEqual(["hello", "one", "two"]);
  });

  it("runs the policy even when middleware short-circuits", async () => {
    shortCircuit = true;
    const result = await client.callTool({
      name: "echo",
      arguments: { message: "bypassed" },
    });
    shortCircuit = false;

    expect(textContent(result)).toBe("short-circuited");
    expect(calls).not.toContain("bypassed");
    expect(events.slice(-2).map(({ phase }) => phase)).toEqual([
      "requested",
      "completed",
    ]);
  });
});
