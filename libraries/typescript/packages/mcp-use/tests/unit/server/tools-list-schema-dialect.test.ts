/**
 * Regression test for issue #1839: tools/list must not emit draft-07 $schema on
 * tool input/output schemas (v2 MCP clients reject non-2020-12 dialects).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../../src/server/index.js";
import { object, text } from "../../../src/server/utils/response-helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TEST_PORT = 3100;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

describe("tools/list schema dialect", () => {
  let server: MCPServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    server = new MCPServer({
      name: "tools-list-schema-dialect-server",
      version: "1.0.0",
    });

    server.tool(
      {
        name: "weather",
        description: "Get weather for a city",
        schema: z.object({
          city: z.string().describe("City name"),
        }),
        outputSchema: z.object({
          city: z.string(),
          tempC: z.number(),
        }),
      },
      async ({ city }) => object({ city, tempC: 22 })
    );

    server.tool(
      {
        name: "echo",
        description: "Echo input without structured output",
        schema: z.object({
          message: z.string(),
        }),
      },
      async ({ message }) => text(message)
    );

    await server.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client({ name: "schema-dialect-test-client", version: "1.0.0" }, {});
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await (server as any).close?.();
  });

  it("strips $schema from inputSchema and outputSchema on tools with outputSchema", async () => {
    const result = await client.listTools();
    const weather = result.tools.find((tool) => tool.name === "weather");
    expect(weather).toBeDefined();

    expect(weather!.inputSchema).toBeDefined();
    expect(weather!.inputSchema).not.toHaveProperty("$schema");
    expect(weather!.inputSchema).toMatchObject({
      type: "object",
      properties: {
        city: expect.objectContaining({ type: "string" }),
      },
      required: ["city"],
    });

    expect(weather!.outputSchema).toBeDefined();
    expect(weather!.outputSchema).not.toHaveProperty("$schema");
    expect(weather!.outputSchema).toMatchObject({
      type: "object",
      properties: {
        city: expect.objectContaining({ type: "string" }),
        tempC: expect.objectContaining({ type: "number" }),
      },
      required: ["city", "tempC"],
    });
  });

  it("lists tools without outputSchema and strips $schema from inputSchema only", async () => {
    const result = await client.listTools();
    const echo = result.tools.find((tool) => tool.name === "echo");
    expect(echo).toBeDefined();
    expect(echo!.outputSchema).toBeUndefined();

    expect(echo!.inputSchema).toBeDefined();
    expect(echo!.inputSchema).not.toHaveProperty("$schema");
    expect(echo!.inputSchema).toMatchObject({
      type: "object",
      properties: {
        message: expect.objectContaining({ type: "string" }),
      },
      required: ["message"],
    });
  });
});
