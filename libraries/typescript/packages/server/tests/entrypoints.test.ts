import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews } from "../src/index.js";

const fileSchema = z.object({
  file: z.object({ name: z.string(), resourceUri: z.string() }),
});
const combinedSchema = fileSchema.partial();
const combinedEntrypoints = [
  { type: "global" },
  { type: "thread" },
  { type: "file", extensions: [".csv"] },
] as const;
describe("entrypoint wire contract over HTTP", () => {
  const server = new MCPServer({ name: "entrypoints", version: "1" });
  const fileCallback = vi.fn((args: z.infer<typeof fileSchema>) => ({
    content: [],
    structuredContent: args,
  }));
  const combinedCallback = vi.fn((args: z.infer<typeof combinedSchema>) => ({
    content: [],
    structuredContent: args,
  }));
  const metadata = {
    "openai/ui": {
      entrypoints: [{ type: "file", extensions: [".txt"] }],
      custom: { preserved: true },
    },
    "example.com/tool": { icons: ["preserved"] },
    ui: { custom: true },
  };
  server.tool(
    {
      name: "open_app",
      title: "My app",
      inputSchema: z.object({
        query: z.string().default("all"),
        optional: z.string().optional(),
      }),
      outputSchema: z.object({ query: z.string() }),
      annotations: { readOnlyHint: true },
      visibility: "app",
      _meta: metadata,
      view: {
        name: "app",
        entrypoints: [{ type: "global" }, { type: "thread" }],
      },
    },
    ({ query }) => ({ content: [], structuredContent: { query } })
  );
  server.tool(
    {
      name: "open_file",
      inputSchema: fileSchema,
      outputSchema: fileSchema,
      view: {
        name: "csv",
        entrypoints: [{ type: "file", extensions: [".csv", ".tar.gz"] }],
      },
    },
    fileCallback
  );
  server.tool(
    {
      name: "open_combined",
      inputSchema: combinedSchema,
      outputSchema: combinedSchema,
      view: { name: "combined", entrypoints: combinedEntrypoints },
    },
    combinedCallback
  );
  server.tool(
    {
      name: "open_optional_file",
      inputSchema: combinedSchema,
      outputSchema: combinedSchema,
      view: {
        name: "optional-file",
        entrypoints: [{ type: "file", extensions: [".csv"] }],
      },
    },
    (args) => ({ content: [], structuredContent: args })
  );
  server[registerViews]({
    "optional-file": { kind: "inline", js: "", css: "" },
    combined: { kind: "inline", js: "", css: "" },
    app: { kind: "inline", js: "", css: "" },
    csv: { kind: "inline", js: "", css: "" },
  });
  let client: Client;
  beforeAll(async () => {
    client = new Client(
      { name: "entrypoints-client", version: "1" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        },
      }
    );
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("https://entrypoints.test/mcp"),
        {
          fetch: async (input, init) => server.fetch(new Request(input, init)),
        }
      )
    );
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });
  it("overrides raw entrypoints without losing other metadata and identity", async () => {
    const before = JSON.stringify(metadata);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "open_app")).toMatchObject({
      title: "My app",
      annotations: { readOnlyHint: true },
      _meta: {
        "openai/ui": {
          ...metadata["openai/ui"],
          entrypoints: [{ type: "global" }, { type: "thread" }],
        },
        "example.com/tool": metadata["example.com/tool"],
        ui: {
          resourceUri: "ui://views/app.html",
          visibility: ["app"],
          custom: true,
        },
      },
    });
    expect(
      tools.find((tool) => tool.name === "open_file")?._meta?.["openai/ui"]
    ).toEqual({
      entrypoints: [{ type: "file", extensions: [".csv", ".tar.gz"] }],
    });
    expect(JSON.stringify(metadata)).toBe(before);
    expect((await client.listTools()).tools).toEqual(tools);
  });
  it("launches global/thread with {} and applies real schema defaults", async () => {
    expect(
      await client.callTool({ name: "open_app", arguments: {} })
    ).toMatchObject({
      structuredContent: { query: "all" },
      _meta: { ui: { resourceUri: "ui://views/app.html" } },
    });
  });
  it("passes the opaque file URI unchanged and stamps the viewer resource", async () => {
    const args = {
      file: {
        name: "report.csv",
        resourceUri: "host-resource://opaque-handle",
      },
    };
    expect(
      await client.callTool({ name: "open_file", arguments: args })
    ).toMatchObject({
      structuredContent: args,
      _meta: { ui: { resourceUri: "ui://views/csv.html" } },
    });
    expect(fileCallback.mock.calls.at(-1)?.[0]).toEqual(args);
  });
  it("advertises all three combined launch locations and accepts both calls", async () => {
    const { tools } = await client.listTools();
    expect(
      tools.find((tool) => tool.name === "open_combined")?._meta?.["openai/ui"]
    ).toEqual({ entrypoints: combinedEntrypoints });
    expect(
      await client.callTool({ name: "open_combined", arguments: {} })
    ).toMatchObject({
      structuredContent: {},
      _meta: { ui: { resourceUri: "ui://views/combined.html" } },
    });
    const args = {
      file: {
        name: "report.csv",
        resourceUri: "host-resource://opaque-handle",
      },
    };
    expect(
      await client.callTool({ name: "open_combined", arguments: args })
    ).toMatchObject({ structuredContent: args });
    expect(combinedCallback.mock.calls.at(-2)?.[0]).toEqual({});
    expect(combinedCallback.mock.calls.at(-1)?.[0]).toEqual(args);
  });
  it("accepts a file-only launcher with an optional file schema", async () => {
    const args = {
      file: {
        name: "report.csv",
        resourceUri: "host-resource://opaque-handle",
      },
    };
    expect(
      await client.callTool({ name: "open_optional_file", arguments: args })
    ).toMatchObject({ structuredContent: args });
    expect(
      await client.callTool({ name: "open_optional_file", arguments: {} })
    ).toMatchObject({ structuredContent: {} });
  });
  it.each([{ file: { name: "file.csv" } }, { file: null }])(
    "uses the input schema to reject malformed files on combined launchers",
    async (args) => {
      const count = combinedCallback.mock.calls.length;
      const result = await client.callTool({
        name: "open_combined",
        arguments: args,
      });
      expect(result.isError).toBe(true);
      expect(combinedCallback.mock.calls).toHaveLength(count);
    }
  );
  it.each([{}, { file: { name: "file.csv" } }, { file: null }])(
    "rejects malformed file arguments before calling the app",
    async (args) => {
      const count = fileCallback.mock.calls.length;
      const result = await client.callTool({
        name: "open_file",
        arguments: args,
      });
      expect(result.isError).toBe(true);
      expect(fileCallback.mock.calls).toHaveLength(count);
    }
  );
});
