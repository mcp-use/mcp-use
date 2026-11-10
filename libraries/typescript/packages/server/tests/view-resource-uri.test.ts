import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { inputRequired, MCPServer, registerViews } from "../src/index.js";
import type { ViewRegistrationOptions } from "../src/views/types.js";

const servers: MCPServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function makeServer(options?: ViewRegistrationOptions) {
  const server = new MCPServer({ name: "versioned-view", version: "1" });
  servers.push(server);
  server[registerViews](
    { dashboard: { kind: "inline", js: 'console.log("built view")', css: "" } },
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
  return server;
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
  it.each([
    [{ buildId: "a1b2c3" }, "ui://views/dashboard-a1b2c3.html"],
    [{ buildId: "a1b2c3", dev: true }, "ui://views/dashboard.html"],
    [undefined, "ui://views/dashboard.html"],
  ] as const)(
    "uses the same URI throughout the wire with %j",
    async (options, uri) => {
      const server = makeServer(options);
      const tools = await rpc(server, "tools/list");
      const meta = { ui: { resourceUri: uri }, "ui/resourceUri": uri };
      expect(tools.result.tools[0]._meta).toMatchObject(meta);
      const called = await rpc(server, "tools/call", { name: "dashboard" });
      expect(called.result._meta).toMatchObject({
        ...meta,
        custom: "preserved",
      });
      const listed = await rpc(server, "resources/list");
      expect(listed.result.resources).toEqual([
        expect.objectContaining({ uri }),
      ]);
      const read = await rpc(server, "resources/read", { uri });
      expect(read.result.contents[0]).toMatchObject({
        uri,
        mimeType: "text/html;profile=mcp-app",
      });
      expect(read.result.contents[0].text).toContain(
        'console.log("built view")'
      );
    }
  );

  it("keeps replicas on one build key and changes the key on a new build", async () => {
    const uris = [];
    for (const buildId of ["a1b2c3", "a1b2c3", "d4e5f6"]) {
      const listed = await rpc(makeServer({ buildId }), "resources/list");
      uris.push(listed.result.resources[0].uri);
    }
    expect(uris).toEqual([
      "ui://views/dashboard-a1b2c3.html",
      "ui://views/dashboard-a1b2c3.html",
      "ui://views/dashboard-d4e5f6.html",
    ]);
  });

  it("does not serve current HTML under an unversioned or previous build URI", async () => {
    const server = makeServer({ buildId: "a1b2c3" });
    for (const uri of [
      "ui://views/dashboard.html",
      "ui://views/dashboard-old.html",
    ]) {
      const read = await rpc(server, "resources/read", { uri });
      expect(read.error.message).toContain("Resource not found");
      expect(read).not.toHaveProperty("result");
    }
  });

  it.each(["error", "input"])("does not stamp %s results", async (mode) => {
    const result = await rpc(makeServer({ buildId: "a1b2c3" }), "tools/call", {
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
