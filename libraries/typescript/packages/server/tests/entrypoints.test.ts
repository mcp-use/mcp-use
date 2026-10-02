import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, registerViews, type ToolDefinition } from "../src/index.js";

const fileSchema = z.object({
  file: z.object({ name: z.string(), resourceUri: z.string() }),
});
const combinedSchema = fileSchema.partial();
const combinedEntrypoints = [
  { type: "global" },
  { type: "thread" },
  { type: "file", extensions: [".csv"] },
] as const;
const base = {
  name: "opener",
  outputSchema: z.object({}),
  view: { name: "viewer" },
};
function register(definition: ToolDefinition): void {
  new MCPServer({ name: "validation", version: "1" }).tool(definition, () => ({
    content: [],
    structuredContent: {},
  }));
}

describe("entrypoint declaration validation", () => {
  it.each(["global", "thread"] as const)(
    "rejects required arguments for %s",
    (type) => {
      expect(() =>
        register({
          ...base,
          inputSchema: z.object({ serverId: z.string() }),
          view: { name: "viewer", entrypoints: [{ type }] },
        })
      ).toThrow("must accept {}");
      expect(() =>
        register({
          ...base,
          schema: z.object({ serverId: z.string() }),
          view: { name: "viewer", entrypoints: [{ type }] },
        })
      ).toThrow("must accept {}");
    }
  );
  it("accepts no schema, optional fields, and defaults on either schema alias", () => {
    for (const input of [
      {},
      { inputSchema: z.object({ query: z.string().optional() }) },
      { schema: z.object({ query: z.string().default("all") }) },
    ]) {
      expect(() =>
        register({
          ...base,
          ...input,
          view: {
            name: "viewer",
            entrypoints: [{ type: "global" }, { type: "thread" }],
          },
        })
      ).not.toThrow();
    }
  });
  it.each(["csv", "image/csv", ".", ".c sv", ".csv,.txt", ".csv/path"])(
    "rejects extension %s",
    (extension) => {
      expect(() =>
        register({
          ...base,
          inputSchema: fileSchema,
          view: {
            name: "viewer",
            entrypoints: [{ type: "file", extensions: [extension] }],
          },
        })
      ).toThrow("HTML accept-style");
    }
  );
  it.each([
    z.object({}),
    z.object({ file: z.string() }),
    z.object({ file: z.object({ name: z.string() }) }),
    z.object({ file: z.object({ name: z.number(), resourceUri: z.string() }) }),
    fileSchema.extend({ requiredId: z.string() }),
    z.object({ file: fileSchema.shape.file.optional() }),
  ])("rejects incompatible file input", (inputSchema) => {
    expect(() =>
      register({
        ...base,
        inputSchema,
        view: {
          name: "viewer",
          entrypoints: [{ type: "file", extensions: [".csv"] }],
        },
      })
    ).toThrow("file launchers require");
  });
  it("requires combined launchers to accept both argument shapes", () => {
    expect(() =>
      register({
        ...base,
        inputSchema: combinedSchema,
        view: { name: "viewer", entrypoints: combinedEntrypoints },
      })
    ).not.toThrow();
    expect(() =>
      register({
        ...base,
        inputSchema: fileSchema,
        view: { name: "viewer", entrypoints: combinedEntrypoints },
      })
    ).toThrow("must accept {}");
    expect(() =>
      register({
        ...base,
        inputSchema: z.object({
          file: z.object({ name: z.string() }).optional(),
        }),
        view: { name: "viewer", entrypoints: combinedEntrypoints },
      })
    ).toThrow("file launchers require");
  });
  it("rejects empty and duplicate declarations", () => {
    expect(() =>
      register({ ...base, view: { name: "viewer", entrypoints: [] } })
    ).toThrow("at least one");
    expect(() =>
      register({
        ...base,
        view: {
          name: "viewer",
          entrypoints: [{ type: "global" }, { type: "global" }],
        },
      })
    ).toThrow("duplicate");
  });
  it("rejects conflicting raw metadata before claiming a view binding", () => {
    const server = new MCPServer({ name: "conflict", version: "1" });
    const callback = () => ({ content: [], structuredContent: {} });
    expect(() =>
      server.tool(
        {
          ...base,
          _meta: { "openai/ui": { entrypoints: [{ type: "thread" }] } },
          view: { name: "viewer", entrypoints: [{ type: "global" }] },
        },
        callback
      )
    ).toThrow("conflicts");
    expect(() =>
      server.tool(
        {
          ...base,
          view: { name: "viewer", entrypoints: [{ type: "global" }] },
        },
        callback
      )
    ).not.toThrow();
  });
});

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
      entrypoints: [{ type: "global" }, { type: "thread" }],
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
  server[registerViews]({
    combined: { kind: "inline", js: "", css: "" },
    app: { kind: "inline", js: "", css: "" },
    csv: { kind: "inline", js: "", css: "" },
  });
  let client: Client;
  beforeAll(async () => {
    const started = await server.listen(0);
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
      new StreamableHTTPClientTransport(new URL(started.url))
    );
  });
  afterAll(async () => {
    await client.close();
    await server.close();
  });
  it("emits typed entrypoints without losing other metadata and identity", async () => {
    const before = JSON.stringify(metadata);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "open_app")).toMatchObject({
      title: "My app",
      annotations: { readOnlyHint: true },
      _meta: {
        "openai/ui": metadata["openai/ui"],
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
  it.each([
    { file: { name: "", resourceUri: "host-resource://file" } },
    { file: { name: "file.csv", resourceUri: "  " } },
    { file: { name: "file.csv" } },
    { file: null },
  ])("rejects malformed supplied files on combined launchers", async (args) => {
    const count = combinedCallback.mock.calls.length;
    const result = await client.callTool({
      name: "open_combined",
      arguments: args,
    });
    expect(result.isError).toBe(true);
    expect(combinedCallback.mock.calls).toHaveLength(count);
  });
  it.each([
    { file: { name: "", resourceUri: "host-resource://file" } },
    { file: { name: "file.csv", resourceUri: "  " } },
    {},
  ])(
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
