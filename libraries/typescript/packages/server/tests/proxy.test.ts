import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { MCPClient } from "@mcp-use/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { MCPServer } from "../src/index.js";

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
      alpha: { url: alphaUrl, oauth: false },
      beta: { url: betaUrl, oauth: false },
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
    await parent.proxy(connection, { namespace: "custom" });
    const { url: parentUrl } = await parent.listen(0);

    const client = await connectClient(parentUrl);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("custom_greet");

    await parent.close();
    expect(connection.isConnected).toBe(true);
  });

  it("rejects proxy registration after the server starts", async () => {
    const upstream = buildUpstream("late");
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(upstream, parent);
    const { url } = await upstream.listen(0);
    await parent.listen(0);

    await expect(parent.proxy({ late: { url, oauth: false } })).rejects.toThrow(
      /proxy\(\) after the server has started/i
    );
  });

  it("rejects collisions without partially mounting a namespace", async () => {
    const upstream = buildUpstream("collision");
    const parent = new MCPServer({ name: "parent", version: "1.0.0" });
    servers.push(upstream, parent);
    const { url } = await upstream.listen(0);
    parent.tool({ name: "up_greet" }, async () => ({
      content: [{ type: "text", text: "local" }],
    }));

    await expect(parent.proxy({ up: { url, oauth: false } })).rejects.toThrow(
      /Cannot proxy tool "up_greet"/
    );

    const { url: parentUrl } = await parent.listen(0);
    const client = await connectClient(parentUrl);
    clients.push(client);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["up_greet"]);
  });
});
