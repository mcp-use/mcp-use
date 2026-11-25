import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { inputRequired, MCPServer, registerViews } from "../src/index.js";
import type { ViewRegistrationOptions } from "../src/views/types.js";

const servers: MCPServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function makeServer(
  options: ViewRegistrationOptions = { buildId: "a1b2c3" },
  extraViews: Record<string, string> = {}
) {
  const server = new MCPServer({ name: "versioned-view", version: "1" });
  servers.push(server);
  server[registerViews](
    {
      dashboard: {
        kind: "inline",
        js: 'console.log("built view")',
        css: "",
      },
      ...Object.fromEntries(
        Object.entries(extraViews).map(([name, js]) => [
          name,
          { kind: "inline" as const, js, css: "" },
        ])
      ),
    },
    options
  );
  server.tool(
    {
      name: "dashboard",
      inputSchema: z.object({ mode: z.string().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      view: { name: "dashboard" },
      _meta: { ui: { resourceUri: "ui://spoofed.html" } },
    },
    async ({ mode }) => {
      if (mode === "error") return { content: [], isError: true };
      if (mode === "input")
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: "Continue?",
              requestedSchema: z.object({ confirm: z.boolean() }),
            }),
          },
        });
      return {
        content: [],
        structuredContent: { ok: true },
        _meta: { custom: "preserved", "ui/resourceUri": "ui://spoofed.html" },
      };
    }
  );
  for (const name of Object.keys(extraViews)) {
    server.tool(
      {
        name,
        outputSchema: z.object({}),
        view: { name },
      },
      async () => ({ content: [], structuredContent: {} })
    );
  }
  return server;
}

async function listedUris(server: MCPServer): Promise<Record<string, string>> {
  const listed = await rpc(server, "resources/list");
  return Object.fromEntries(
    listed.result.resources.map((resource: { name: string; uri: string }) => [
      resource.name,
      resource.uri,
    ])
  );
}

async function rpc(
  server: MCPServer,
  method: string,
  params: Record<string, unknown> = {}
) {
  const name = params.name ?? params.uri;
  const response = await server.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(typeof name === "string" && { "mcp-name": name }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              elicitation: { form: {} },
            },
          },
        },
      }),
    })
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("view resource cache keys", () => {
  it("uses one build-versioned URI throughout the wire in production", async () => {
    const server = makeServer();
    const uri = "ui://views/dashboard.html?v=a1b2c3";
    expect(await listedUris(server)).toEqual({ dashboard: uri });
    const tools = await rpc(server, "tools/list");
    const meta = { ui: { resourceUri: uri }, "ui/resourceUri": uri };
    expect(tools.result.tools[0]._meta).toMatchObject(meta);
    const called = await rpc(server, "tools/call", { name: "dashboard" });
    expect(called.result._meta).toMatchObject({
      ...meta,
      custom: "preserved",
    });
    const read = await rpc(server, "resources/read", { uri });
    expect(read.result.contents[0]).toMatchObject({
      uri,
      mimeType: "text/html;profile=mcp-app",
    });
    expect(read.result.contents[0].text).toContain('console.log("built view")');
  });

  it.each([
    ["development", { dev: true, buildId: "a1b2c3" }],
    ["views primed without a build ID", {}],
  ] as const)("keeps unversioned URIs in %s", async (_label, options) => {
    const server = makeServer(options);
    expect(await listedUris(server)).toEqual({
      dashboard: "ui://views/dashboard.html",
    });
    const tools = await rpc(server, "tools/list");
    expect(tools.result.tools[0]._meta["ui/resourceUri"]).toBe(
      "ui://views/dashboard.html"
    );
  });

  it("keeps replicas on one build key and changes only the query on a new build", async () => {
    const uris = [];
    for (const buildId of ["a1b2c3", "a1b2c3", "d4e5f6"]) {
      uris.push((await listedUris(makeServer({ buildId })))["dashboard"]);
    }
    expect(uris).toEqual([
      "ui://views/dashboard.html?v=a1b2c3",
      "ui://views/dashboard.html?v=a1b2c3",
      "ui://views/dashboard.html?v=d4e5f6",
    ]);
  });

  it("does not let views whose names share a prefix shadow each other", async () => {
    const server = makeServer(undefined, {
      "dashboard-wide": 'console.log("wide view")',
    });
    const old = "ui://views/dashboard-wide-0123456789abcdef.html";
    const read = await rpc(server, "resources/read", { uri: old });
    expect(read.result.contents[0].uri).toBe(old);
    expect(read.result.contents[0].text).toContain('console.log("wide view")');
  });

  it.each([
    "ui://views/dashboard.html",
    "ui://views/dashboard.html?v=0123abcd",
    "ui://views/dashboard-0123456789abcdef.html",
  ])(
    "serves the current view under a URI from an earlier deployment: %s",
    async (uri) => {
      const read = await rpc(makeServer(), "resources/read", { uri });
      expect(read.result.contents[0]).toMatchObject({
        uri,
        mimeType: "text/html;profile=mcp-app",
      });
      expect(read.result.contents[0].text).toContain(
        'console.log("built view")'
      );
    }
  );

  it.each([
    "ui://views/missing.html?v=0123abcd",
    "ui://views/missing-0123456789abcdef.html",
    "ui://views/dashboard-old.html",
  ])("returns resource-not-found for %s", async (uri) => {
    const read = await rpc(makeServer(), "resources/read", { uri });
    expect(read.error.message).toContain("Resource not found");
    expect(read).not.toHaveProperty("result");
  });

  it.each(["error", "input"])("does not stamp %s results", async (mode) => {
    const result = await rpc(makeServer(), "tools/call", {
      name: "dashboard",
      arguments: { mode },
    });
    expect(result.error).toBeUndefined();
    expect(result.result._meta ?? {}).not.toHaveProperty("ui");
    expect(result.result._meta ?? {}).not.toHaveProperty("ui/resourceUri");
    if (mode === "error") expect(result.result.isError).toBe(true);
    else expect(result.result.inputRequests).toHaveProperty("confirm");
  });
});
