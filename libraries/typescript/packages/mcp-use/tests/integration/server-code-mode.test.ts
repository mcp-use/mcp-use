import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  MCPServer,
  text,
  type CodeModeSandboxBackend,
} from "../../src/server/index.js";

const TEST_PORT = 3108;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

function toolNames(result: Awaited<ReturnType<Client["listTools"]>>): string[] {
  return result.tools.map((tool) => tool.name);
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.find((item) => item.type === "text")?.text ?? "";
}

describe("server code mode", () => {
  let active = false;
  let server: MCPServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    const sandbox: CodeModeSandboxBackend = {
      id: "fake-test-sandbox",
      async execute(request) {
        if (request.code === "call:add") {
          return request.callTool("add", { a: 2, b: 3 });
        }
        if (request.code === "call:secret") {
          try {
            return await request.callTool("secret", {});
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
        return {
          code: request.code,
          availableTools: request.tools.map((tool) => tool.name),
        };
      },
    };

    server = new MCPServer({
      name: "server-code-mode-test",
      version: "1.0.0",
    });

    server.enableCodeMode({
      activate: () => active,
      tools: { include: ["add", "secret"], exclude: ["secret"] },
      sandbox,
    });

    server.tool(
      {
        name: "add",
        description: "Add two numbers",
        schema: z.object({ a: z.number(), b: z.number() }),
      },
      async ({ a, b }) => text(String(a + b))
    );

    server.tool(
      {
        name: "secret",
        description: "Excluded backing tool",
        schema: z.object({}),
      },
      async () => text("secret")
    );

    await server.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client({ name: "test-client", version: "1.0.0" }, {});
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await (server as any).close?.();
  });

  it("swaps tools/list only when activated", async () => {
    active = false;
    expect(toolNames(await client.listTools())).toEqual(["add", "secret"]);

    active = true;
    expect(toolNames(await client.listTools())).toEqual([
      "search_tools",
      "execute_js",
    ]);
  });

  it("blocks direct backing calls while allowing sandbox-mediated calls", async () => {
    active = true;

    const direct = await client.callTool({
      name: "add",
      arguments: { a: 2, b: 3 },
    });
    expect(direct.isError).toBe(true);
    expect(textContent(direct)).toContain("internal while code mode is active");

    const mediated = await client.callTool({
      name: "execute_js",
      arguments: { code: "call:add" },
    });
    expect(textContent(mediated)).toBe("5");
  });

  it("enforces backing tool allow/exclude policy inside the sandbox callback", async () => {
    active = true;

    const result = await client.callTool({
      name: "execute_js",
      arguments: { code: "call:secret" },
    });

    expect((result.structuredContent as { error?: string }).error).toContain(
      'Tool "secret" is not available in code mode'
    );
  });
});
