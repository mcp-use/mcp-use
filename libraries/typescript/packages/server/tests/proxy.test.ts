import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MCPClient } from "@mcp-use/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";
import type { ProxyConnection } from "../src/index.js";
import { mountProxyConnection } from "../src/proxy.js";
import type { ProxyMountHost } from "../src/proxy.js";

async function connectClient(url: string): Promise<Client> {
  const client = new Client(
    { name: "proxy-test-client", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } }
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

function buildUpstream(label: string): MCPServer {
  const upstream = new MCPServer({ name: label, version: "1.0.0" });

  upstream.tool(
    {
      name: "greet",
      description: `Greet through ${label}`,
      inputSchema: z.object({ name: z.string().describe("Person to greet") }),
      outputSchema: z.object({ greeting: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      const data = { greeting: `${label}: Hello, ${name}!` };
      return {
        content: [{ type: "text", text: data.greeting }],
        structuredContent: data,
      };
    }
  );

  upstream.tool(
    {
      name: "fail",
      inputSchema: z.object({ reason: z.string() }),
    },
    async ({ reason }) => ({
      content: [{ type: "text", text: `${label} failed: ${reason}` }],
      isError: true,
    })
  );

  upstream.resource(
    {
      name: "notes",
      uri: `notes://${label}`,
      description: `${label} notes`,
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `${label} note body`,
        },
      ],
    })
  );

  upstream.prompt(
    {
      name: "summarize",
      description: `Summarize through ${label}`,
      schema: z.object({ text: z.string().describe("Text to summarize") }),
    },
    async ({ text }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `${label}: Summarize ${text}` },
        },
      ],
    })
  );

  return upstream;
}

describe("MCPServer.proxy", () => {
  const servers: MCPServer[] = [];
  const clients: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("proxies multiple configured servers through @mcp-use/client v2", async () => {
    const alpha = buildUpstream("alpha");
    const beta = buildUpstream("beta");
    servers.push(alpha, beta);
    const [{ url: alphaUrl }, { url: betaUrl }] = await Promise.all([
      alpha.listen(0),
      beta.listen(0),
    ]);

    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(parent);
    parent.tool({ name: "local" }, async () => ({
      content: [{ type: "text", text: "local" }],
    }));
    await parent.proxy({
      alpha: { url: alphaUrl },
      beta: { url: betaUrl },
    });
    const { url: parentUrl } = await parent.listen(0);

    const client = await connectClient(parentUrl);
    clients.push(client);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "alpha_fail",
      "alpha_greet",
      "beta_fail",
      "beta_greet",
      "local",
    ]);
    expect(tools.find((tool) => tool.name === "alpha_greet")).toMatchObject({
      description: "Greet through alpha",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Person to greet" },
        },
      },
      outputSchema: {
        type: "object",
        required: ["greeting"],
      },
    });

    const alphaGreeting = await client.callTool({
      name: "alpha_greet",
      arguments: { name: "Ada" },
    });
    expect(alphaGreeting).toMatchObject({
      content: [{ type: "text", text: "alpha: Hello, Ada!" }],
      structuredContent: { greeting: "alpha: Hello, Ada!" },
    });

    const failure = await client.callTool({
      name: "beta_fail",
      arguments: { reason: "offline" },
    });
    expect(failure).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "beta failed: offline" }],
    });

    const { resources } = await client.listResources();
    const alphaResource = resources.find(
      (resource) => resource.name === "alpha_notes"
    );
    expect(alphaResource?.uri).toBe(
      `mcp-use-proxy:///alpha/${encodeURIComponent("notes://alpha")}`
    );
    const read = await client.readResource({ uri: alphaResource!.uri });
    expect(read.contents[0]).toMatchObject({ text: "alpha note body" });

    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "alpha_summarize",
      "beta_summarize",
    ]);
    const prompt = await client.getPrompt({
      name: "beta_summarize",
      arguments: { text: "this" },
    });
    expect(prompt.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "beta: Summarize this" },
      },
    ]);
  });

  it("mounts an existing caller-owned MCPConnection", async () => {
    const upstream = buildUpstream("direct");
    servers.push(upstream);
    const { url } = await upstream.listen(0);

    const upstreamClient = new MCPClient({
      mcpServers: { direct: { url, oauth: false } },
    });
    clients.push(upstreamClient);
    const connection = await upstreamClient.connect("direct");

    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(parent);
    await parent.proxy(connection);
    const { url: parentUrl } = await parent.listen(0);

    const client = await connectClient(parentUrl);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("direct_greet");

    await parent.close();
    expect(connection.isConnected).toBe(true);
  });

  it("rejects proxy registration after the server starts", async () => {
    const upstream = buildUpstream("late");
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(upstream, parent);
    const { url } = await upstream.listen(0);
    await parent.listen(0);

    await expect(parent.proxy({ late: { url } })).rejects.toThrow(
      /proxy\(\) after the server has started/i
    );
  });

  it("skips collisions while mounting the remaining capabilities", async () => {
    const upstream = buildUpstream("collision");
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(upstream, parent);
    const { url } = await upstream.listen(0);
    parent.tool({ name: "up_greet" }, async () => ({
      content: [{ type: "text", text: "local" }],
    }));

    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(parent.proxy({ up: { url } })).resolves.toBeUndefined();

    const { url: parentUrl } = await parent.listen(0);
    const client = await connectClient(parentUrl);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "up_fail",
      "up_greet",
    ]);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.stringContaining('Skipping proxied tool "up_greet"')
    );
  });

  it("continues after a configured upstream fails to connect", async () => {
    const upstream = buildUpstream("healthy");
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(upstream, parent);
    const { url } = await upstream.listen(0);
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      parent.proxy({
        offline: {
          url: "https://offline.example/mcp",
          fetch: async () => {
            throw new Error("upstream unavailable");
          },
        },
        healthy: { url },
      })
    ).resolves.toBeUndefined();

    const { url: parentUrl } = await parent.listen(0);
    const client = await connectClient(parentUrl);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("healthy_greet");
    expect(diagnostics).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to connect to upstream MCP server "offline"'
      )
    );
  });

  it("keeps other capability kinds when one introspection request fails", async () => {
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(parent);
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    const connection: ProxyConnection = {
      info: { server: { name: "partial" } },
      async listTools() {
        throw new Error("tools unavailable");
      },
      async callTool() {
        return { content: [] };
      },
      async listAllResources() {
        return {
          resources: [
            {
              name: "notes",
              uri: "notes://partial",
              mimeType: "text/plain",
            },
          ],
        };
      },
      async readResource(uri) {
        return { contents: [{ uri, text: "partial notes" }] };
      },
      async listPrompts() {
        return {
          prompts: [
            {
              name: "special",
              arguments: [{ name: "__proto__", required: true }],
            },
          ],
        };
      },
      async getPrompt() {
        return { messages: [] };
      },
    };

    await expect(parent.proxy(connection)).resolves.toBeUndefined();
    const { url: parentUrl } = await parent.listen(0);
    const client = await connectClient(parentUrl);
    clients.push(client);

    expect((await client.listTools()).tools).toEqual([]);
    expect((await client.listResources()).resources).toEqual([
      expect.objectContaining({ name: "partial_notes" }),
    ]);
    expect((await client.listPrompts()).prompts).toEqual([
      expect.objectContaining({
        name: "partial_special",
        arguments: [expect.objectContaining({ name: "__proto__" })],
      }),
    ]);
    expect(diagnostics).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to introspect tools from upstream MCP server "partial"'
      )
    );
  });

  it("contains rejected downstream progress notifications", async () => {
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    let mountedTool:
      | ((params: Record<string, unknown>, ctx: unknown) => Promise<unknown>)
      | undefined;
    const host: ProxyMountHost = {
      isStarted: () => false,
      hasTool: () => false,
      hasResource: () => false,
      hasPrompt: () => false,
      registerTool: (_definition, callback) => {
        mountedTool = callback as unknown as typeof mountedTool;
      },
      registerResource: () => {
        throw new Error("unexpected resource registration");
      },
      registerPrompt: () => {
        throw new Error("unexpected prompt registration");
      },
      trackOwner: () => {},
    };
    const connection: ProxyConnection = {
      info: { server: { name: "progress" } },
      supports: (capability) => capability === "tools",
      async listTools() {
        return [{ name: "stream" }];
      },
      async callTool(_name, _args, options) {
        expect(
          options?.onprogress?.({ progress: 1, total: 2, message: "half" })
        ).toBeUndefined();
        return { content: [] };
      },
      async readResource() {
        return { contents: [] };
      },
      async listPrompts() {
        return { prompts: [] };
      },
      async getPrompt() {
        return { messages: [] };
      },
    };

    await mountProxyConnection(host, connection);
    expect(mountedTool).toBeDefined();
    await mountedTool?.(
      {},
      {
        signal: new AbortController().signal,
        reportProgress: async () => {
          throw new Error("downstream disconnected");
        },
      }
    );
    expect(diagnostics).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to forward progress for proxied tool "progress_stream"'
      )
    );
  });

  it("delivers progress in order before settling the proxied tool call", async () => {
    let mountedTool:
      | ((params: Record<string, unknown>, ctx: unknown) => Promise<unknown>)
      | undefined;
    const host: ProxyMountHost = {
      isStarted: () => false,
      hasTool: () => false,
      hasResource: () => false,
      hasPrompt: () => false,
      registerTool: (_definition, callback) => {
        mountedTool = callback as unknown as typeof mountedTool;
      },
      registerResource: () => {
        throw new Error("unexpected resource registration");
      },
      registerPrompt: () => {
        throw new Error("unexpected prompt registration");
      },
      trackOwner: () => {},
    };
    const connection: ProxyConnection = {
      info: { server: { name: "ordered-progress" } },
      supports: (capability) => capability === "tools",
      async listTools() {
        return [{ name: "stream" }];
      },
      async callTool(_name, _args, options) {
        options?.onprogress?.({ progress: 1 });
        options?.onprogress?.({ progress: 2 });
        return { content: [] };
      },
      async readResource() {
        return { contents: [] };
      },
      async listPrompts() {
        return { prompts: [] };
      },
      async getPrompt() {
        return { messages: [] };
      },
    };

    await mountProxyConnection(host, connection);
    expect(mountedTool).toBeDefined();

    let releaseFirstProgress: (() => void) | undefined;
    const firstProgressBlocked = new Promise<void>((resolve) => {
      releaseFirstProgress = resolve;
    });
    const forwarded: number[] = [];
    let settled = false;
    const call = mountedTool!(
      {},
      {
        signal: new AbortController().signal,
        reportProgress: async (progress: number) => {
          forwarded.push(progress);
          if (progress === 1) await firstProgressBlocked;
        },
      }
    ).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(forwarded).toEqual([1]));
    expect(settled).toBe(false);
    releaseFirstProgress?.();
    await call;
    expect(forwarded).toEqual([1, 2]);
  });
});
