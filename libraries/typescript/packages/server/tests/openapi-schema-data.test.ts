import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { MCPServer, type OpenAPIDocument } from "../src/index.js";

describe("OpenAPI schema data keywords", () => {
  it.each([
    ["nullable object enum", { nullable: true, label: "kept" }],
    ["reference-shaped object enum", { $ref: "literal-data", label: "kept" }],
    [
      "nested object enum",
      { payload: { nullable: true, $ref: "literal-data" } },
    ],
    ["ordinary object enum", { label: "kept" }],
  ])("preserves %s", async (_label, value) => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Data keywords" },
      servers: [{ url: "https://upstream.example" }],
      paths: {
        "/check": {
          post: {
            operationId: "check",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    enum: [value],
                    const: value,
                    default: value,
                    examples: [value],
                    example: value,
                  },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true })
    );
    const server = MCPServer.fromOpenAPI({
      spec: spec as unknown as OpenAPIDocument,
      fetch: fetchImpl,
    });
    const started = await server.listen(0);
    const client = new Client(
      { name: "schema-data", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(started.url))
      );
      const { tools } = await client.listTools();
      const result = await client.callTool({
        name: "check",
        arguments: { body: value },
      });
      expect(result.isError).not.toBe(true);
      expect(tools[0]?.inputSchema.properties?.body).toMatchObject({
        enum: [value],
        const: value,
        default: value,
        examples: [value],
        example: value,
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(value));
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("converts schemas under data-keyword property names", async () => {
    const names = ["enum", "const", "default", "examples", "example"];
    const spec: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Schema maps" },
      servers: [{ url: "https://upstream.example" }],
      paths: {
        "/check": {
          post: {
            operationId: "check",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: Object.fromEntries(
                      names.map((name) => [
                        name,
                        { type: "string", nullable: true },
                      ])
                    ),
                  },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ ok: true })
    );
    const server = MCPServer.fromOpenAPI({ spec, fetch: fetchImpl });
    const started = await server.listen(0);
    const client = new Client(
      { name: "schema-map", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(started.url))
      );
      const result = await client.callTool({
        name: "check",
        arguments: {
          body: Object.fromEntries(names.map((name) => [name, null])),
        },
      });
      expect(result.isError).not.toBe(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
