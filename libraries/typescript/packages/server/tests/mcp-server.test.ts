/**
 * End-to-end tests for the MCPServer Phase-1 surface: tools, resources,
 * resource templates, prompts, and completion — exercised over real HTTP with
 * the official @modelcontextprotocol/client. No mocks.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, completable } from "../src/index.js";
import type { ServerConfig, StandardSchemaWithJSON } from "../src/index.js";

/**
 * Hand-rolled Standard Schema (validate + JSON Schema converter, no zod):
 * proves the schema surface accepts any StandardSchemaWithJSON implementation
 * and that params are inferred from its Output type.
 */
const echoInput: StandardSchemaWithJSON<
  { message: string },
  { message: string }
> = {
  "~standard": {
    version: 1,
    vendor: "hand-rolled",
    validate(value) {
      const message =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)["message"]
          : undefined;
      if (typeof message !== "string") {
        return { issues: [{ message: "message: expected string" }] };
      }
      return { value: { message } };
    },
    jsonSchema: {
      input: () => ({
        type: "object",
        properties: {
          message: { type: "string", description: "Text to echo back" },
        },
        required: ["message"],
      }),
      output: () => ({
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      }),
    },
  },
};

function buildServer(): MCPServer {
  const server = new MCPServer({
    name: "phase1-test",
    version: "1.0.0",
    title: "Phase 1 Test Server",
    instructions: "Test fixture covering the Phase-1 API surface.",
  });

  server.tool(
    {
      name: "fetch-weather",
      title: "Fetch weather",
      description: "Fetch the weather for a city",
      inputSchema: z.object({
        city: z.string().describe("The city to fetch the weather for"),
      }),
      outputSchema: z.object({
        city: z.string(),
        conditions: z.string(),
        temperature: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ city }) => {
      const data = { city, conditions: "sunny", temperature: "22°C" };
      return {
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
  );

  server.tool(
    {
      name: "roll-dice",
      description: "Roll dice; structured output is a bare array",
      // Non-object schema root: legal on the 2026-07-28 wire.
      outputSchema: z.array(z.number().int()),
    },
    async () => ({ content: [], structuredContent: [3, 5] })
  );

  server.tool(
    { name: "whoami", description: "Report request presence" },
    async (_params, ctx) => ({
      content: [{ type: "text", text: ctx.request ? "http" : "unknown" }],
    })
  );

  server.tool(
    {
      name: "fail",
      description: "Always errors",
      inputSchema: z.object({ reason: z.string() }),
    },
    async ({ reason }) => ({
      content: [{ type: "text", text: `failed: ${reason}` }],
      isError: true,
    })
  );

  server.tool(
    {
      name: "echo",
      description: "Echo a message, uppercased",
      // `schema` is accepted as an alias for `inputSchema`.
    schema: echoInput,
    },
    // `message: string` is inferred from the hand-rolled schema's Output type.
    async ({ message }) => ({
      content: [{ type: "text", text: message.toUpperCase() }],
    })
  );

  server.resource(
    {
      name: "config",
      uri: "config://settings",
      description: "Server configuration",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ theme: "dark", language: "en" }),
        },
      ],
    })
  );

  server.resource(
    {
      name: "notes",
      uri: "notes://readme",
      description: "Markdown notes",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: "# Notes" }],
    })
  );

  server.resourceTemplate(
    {
      name: "greeting",
      uriTemplate: "greeting://{name}",
      description: "Personalized greeting",
      mimeType: "text/plain",
    },
    async (uri, params) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: `Hello, ${String(params.name)}!`,
        },
      ],
    })
  );

  server.prompt(
    {
      name: "review-code",
      description: "Review code for best practices",
      schema: z.object({
        language: completable(z.string().describe("The programming language"), [
          "python",
          "typescript",
          "go",
        ]),
        code: z.string().describe("The code to review"),
      }),
    },
    async ({ language, code }) => ({
      description: "Code review request",
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Reviewing ${language}:\n${code}` },
        },
      ],
    })
  );

  server.prompt(
    { name: "standup", description: "Daily standup template" },
    async () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "What did you do yesterday?" },
        },
      ],
    })
  );

  return server;
}

describe("MCPServer (phase 1, e2e over HTTP)", () => {
  const server = buildServer();
  let url: string;
  let client: Client;

  beforeAll(async () => {
    const started = await server.listen(0);
    url = started.url;
    client = new Client(
      { name: "phase1-test-client", version: "1.0.0" },
      // The client's default posture is the legacy 2025 handshake — pin the
      // modern revision to exercise the 2026-07-28 wire.
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  it("lists tools with metadata and schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "echo",
      "fail",
      "fetch-weather",
      "roll-dice",
      "whoami",
    ]);

    const weather = tools.find((t) => t.name === "fetch-weather");
    expect(weather?.title).toBe("Fetch weather");
    expect(weather?.description).toBe("Fetch the weather for a city");
    expect(weather?.annotations?.readOnlyHint).toBe(true);
    expect(weather?.inputSchema).toMatchObject({
      type: "object",
      required: ["city"],
    });
    expect(weather?.outputSchema).toMatchObject({ type: "object" });
  });

  it("calls a tool and returns validated structuredContent", async () => {
    const result = await client.callTool({
      name: "fetch-weather",
      arguments: { city: "Berlin" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      city: "Berlin",
      conditions: "sunny",
      temperature: "22°C",
    });
  });

  it("supports non-object structuredContent roots (2026-07-28 wire)", async () => {
    const result = await client.callTool({ name: "roll-dice", arguments: {} });
    expect(result.isError).toBeFalsy();
    // The bare array passes outputSchema validation unwrapped, and the SDK
    // auto-appends the JSON text block (SEP-2106) for non-object payloads.
    expect(result.structuredContent).toEqual([3, 5]);
    expect(result.content).toEqual([{ type: "text", text: "[3,5]" }]);
  });

  it("serves resource contents with their authored mimeType", async () => {
    const result = await client.readResource({ uri: "notes://readme" });
    const [content] = result.contents;
    expect(content?.mimeType).toBe("text/markdown");
  });

  it("rejects invalid tool arguments via schema validation", async () => {
    // The SDK surfaces input-validation failures as isError tool results.
    const result = await client.callTool({
      name: "fetch-weather",
      arguments: { city: 42 },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/city.*expected string/i) as string,
      },
    ]);
  });

  it("serves a tool declared with a hand-rolled Standard Schema", async () => {
    const { tools } = await client.listTools();
    const echo = tools.find((t) => t.name === "echo");
    // inputSchema advertised via the schema's own ~standard.jsonSchema converter.
    expect(echo?.inputSchema).toMatchObject({
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string", description: "Text to echo back" },
      },
    });

    const result = await client.callTool({
      name: "echo",
      arguments: { message: "hello" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "HELLO" }]);

    // Invalid input is rejected via the schema's own ~standard.validate.
    const invalid = await client.callTool({
      name: "echo",
      arguments: { message: 42 },
    });
    expect(invalid.isError).toBe(true);
  });

  it("passes a request-scoped context to callbacks", async () => {
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.content).toEqual([{ type: "text", text: "http" }]);
  });

  it("returns isError results", async () => {
    const result = await client.callTool({
      name: "fail",
      arguments: { reason: "on purpose" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "failed: on purpose" },
    ]);
  });

  it("lists and reads a static resource as JSON", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("config://settings");

    const result = await client.readResource({ uri: "config://settings" });
    const [content] = result.contents;
    if (content === undefined || !("text" in content)) {
      throw new Error("expected text resource contents");
    }
    expect(content.uri).toBe("config://settings");
    expect(content.mimeType).toBe("application/json");
    expect(JSON.parse(content.text)).toEqual({
      theme: "dark",
      language: "en",
    });
  });

  it("reads a templated resource with extracted variables", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain(
      "greeting://{name}"
    );

    const result = await client.readResource({ uri: "greeting://world" });
    const [content] = result.contents;
    if (content === undefined || !("text" in content)) {
      throw new Error("expected text resource contents");
    }
    expect(content.mimeType).toBe("text/plain");
    expect(content.text).toBe("Hello, world!");
  });

  it("lists prompts and renders one with arguments", async () => {
    const { prompts } = await client.listPrompts();
    const review = prompts.find((p) => p.name === "review-code");
    expect(review?.arguments?.map((a) => a.name).sort()).toEqual([
      "code",
      "language",
    ]);

    const result = await client.getPrompt({
      name: "review-code",
      arguments: { language: "go", code: "func main() {}" },
    });
    // The result's description is the callback's own, passed through verbatim
    // (the definition's description is listing metadata only).
    expect(result.description).toBe("Code review request");
    expect(result.messages).toEqual([
      {
        role: "user",
        content: { type: "text", text: "Reviewing go:\nfunc main() {}" },
      },
    ]);
  });

  it("renders a prompt without a schema", async () => {
    const result = await client.getPrompt({ name: "standup" });
    expect(result.messages[0]?.content).toEqual({
      type: "text",
      text: "What did you do yesterday?",
    });
  });

  it("completes completable prompt arguments by prefix", async () => {
    const result = await client.complete({
      ref: { type: "ref/prompt", name: "review-code" },
      argument: { name: "language", value: "py" },
    });
    expect(result.completion.values).toEqual(["python"]);
  });

  it("rejects registrations after the server has started", () => {
    expect(() =>
      server.tool({ name: "late" }, async () => ({
        content: [{ type: "text", text: "late" }],
      }))
    ).toThrow(/after the server has started/);
  });

  it("serves fresh per-request instances to concurrent clients", async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const c = new Client(
          { name: "concurrent", version: "1.0.0" },
          { versionNegotiation: { mode: { pin: "2026-07-28" } } }
        );
        await c.connect(new StreamableHTTPClientTransport(new URL(url)));
        return c;
      })
    );
    try {
      const results = await Promise.all(
        clients.map((c, i) =>
          c.callTool({ name: "fetch-weather", arguments: { city: `c${i}` } })
        )
      );
      results.forEach((r, i) => {
        expect(r.structuredContent).toMatchObject({ city: `c${i}` });
      });
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
  });

  // DNS-rebinding protection from @modelcontextprotocol/hono. Uses node:http
  // directly because fetch() sanitizes Host/Origin headers.
  it("rejects requests with a non-localhost Host header (DNS rebinding)", async () => {
    const status = await rawStatus(url, { host: "evil.example.com" });
    expect(status).toBe(403);
  });

  it("rejects requests from a non-localhost Origin", async () => {
    const status = await rawStatus(url, { origin: "https://evil.example.com" });
    expect(status).toBe(403);
  });

  it("accepts requests with a localhost Origin", async () => {
    const status = await rawStatus(url, { origin: "http://localhost:3000" });
    expect(status).not.toBe(403);
  });
});

/** Issue a raw POST with unsanitized headers; resolves with the status code. */
async function rawStatus(
  target: string,
  headers: Record<string, string>
): Promise<number> {
  const { request } = await import("node:http");
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-method": "tools/list",
          "content-length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

/*
 * Legacy (2025-era) serving posture: `legacy: "stateless"` is the default —
 * non-envelope requests are answered by a fresh instance over a session-less
 * transport; `legacy: "reject"` refuses them with the
 * unsupported-protocol-version error.
 */
describe("MCPServer legacy posture", () => {
  /** A 2025-era initialize request: no per-request _meta envelope. */
  function legacyInitializeRequest(): Request {
    return new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-client", version: "0.0.0" },
        },
      }),
    });
  }

  function minimalServer(config: Partial<ServerConfig> = {}): MCPServer {
    const server = new MCPServer({
      name: "legacy-test",
      version: "1.0.0",
      description: "Legacy posture fixture",
      ...config,
    });
    server.tool({ name: "ping" }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    return server;
  }

  it("serves 2025-era clients statelessly by default", async () => {
    const server = minimalServer();
    const response = await server.getHandler()(legacyInitializeRequest());
    expect(response.status).toBe(200);
    await server.close();
  });

  it("rejects 2025-era clients under legacy: 'reject'", async () => {
    const server = minimalServer({ legacy: "reject" });
    const response = await server.getHandler()(legacyInitializeRequest());
    expect(response.ok).toBe(false);
    await server.close();
  });

  it("reports config.description as implementation metadata", async () => {
    const server = minimalServer();
    const response = await server.getHandler()(legacyInitializeRequest());
    // Legacy serving answers over streamable-HTTP SSE framing; the initialize
    // result is the first `data:` line.
    const text = await response.text();
    const dataLine = text
      .split("\n")
      .find((line) => line.startsWith("data:"));
    expect(dataLine).toBeDefined();
    const body: unknown = JSON.parse((dataLine as string).slice("data:".length));
    expect(body).toMatchObject({
      result: {
        serverInfo: {
          name: "legacy-test",
          description: "Legacy posture fixture",
        },
      },
    });
    await server.close();
  });
});

describe("MCPServer basePath accessor", () => {
  it("defaults to /mcp", () => {
    const server = new MCPServer({ name: "bp-test", version: "1.0.0" });
    expect(server.basePath).toBe("/mcp");
  });

  it("reflects config.basePath", () => {
    const server = new MCPServer({
      name: "bp-test",
      version: "1.0.0",
      basePath: "/api/mcp",
    });
    expect(server.basePath).toBe("/api/mcp");
  });

  it("strips a trailing slash except for root /", () => {
    const withSlash = new MCPServer({
      name: "bp-test",
      version: "1.0.0",
      basePath: "/mcp/",
    });
    expect(withSlash.basePath).toBe("/mcp");

    const root = new MCPServer({
      name: "bp-test",
      version: "1.0.0",
      basePath: "/",
    });
    expect(root.basePath).toBe("/");
  });

  it("rejects invalid basePath values at construction", () => {
    for (const basePath of ["//", "/foo//bar", "/mcp?x", "/mcp#x", "mcp"]) {
      expect(
        () =>
          new MCPServer({
            name: "bp-test",
            version: "1.0.0",
            basePath,
          })
      ).toThrow(TypeError);
    }
  });
});

describe("MCPServer getHandler (no network)", () => {
  it("serves MCP through the web-standard handler on a custom basePath", async () => {
    const server = new MCPServer({
      name: "handler-test",
      version: "1.0.0",
      basePath: "/api/mcp",
    });
    server.tool({ name: "ping" }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    const handler = server.getHandler();

    const response = await handler(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "ping",
            arguments: {},
            // The stateless 2026-07-28 wire replaces the initialize handshake
            // with a per-request _meta envelope; these three keys are required.
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "raw-request",
                version: "0.0.0",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    // Modern (2026-07-28) exchanges answer with a single JSON body unless the
    // handler streams a related message first (responseMode 'auto').
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      result: { content: [{ type: "text", text: "pong" }] },
    });
    await server.close();
  });
});

/*
 * Host/Origin validation policy: listen() on a localhost bind validates by
 * default (DNS-rebinding protection), getHandler() applies no validation
 * unless configured (a fetch handler never binds — a platform edge in front
 * only routes hostnames assigned to the deployment), and configured lists
 * are additive to the localhost allowlists.
 */
describe("MCPServer validation policy", () => {
  function minimalServer(config: Partial<ServerConfig> = {}): MCPServer {
    const server = new MCPServer({
      name: "policy-test",
      version: "1.0.0",
      ...config,
    });
    server.tool({ name: "ping" }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));
    return server;
  }

  /** Synthetic tools/list Request for driving a getHandler() directly. */
  function toolsListRequest(headers: Record<string, string> = {}): Request {
    return new Request("http://placeholder.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "raw-request",
              version: "0.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
  }

  it("getHandler serves foreign Hosts when nothing is configured", async () => {
    const server = minimalServer();
    const response = await server
      .getHandler()(toolsListRequest({ host: "my-app.vercel.app" }));
    expect(response.status).toBe(200);
    await server.close();
  });

  it("getHandler with allowedHosts validates additively", async () => {
    const server = minimalServer({ allowedHosts: ["api.example.com"] });
    const handler = server.getHandler();
    const status = async (host: string) =>
      (await handler(toolsListRequest({ host }))).status;
    expect(await status("api.example.com")).toBe(200);
    expect(await status("evil.example.com")).toBe(403);
    // Additive: the localhost allowlist survives, so local runs keep working.
    expect(await status("localhost")).toBe(200);
    await server.close();
  });

  it("mirrors allowedHosts into Origin validation when allowedOrigins is unset", async () => {
    const server = minimalServer({ allowedHosts: ["api.example.com"] });
    const handler = server.getHandler();
    const status = async (origin: string) =>
      (
        await handler(
          toolsListRequest({ host: "api.example.com", origin })
        )
      ).status;
    expect(await status("https://api.example.com")).toBe(200);
    expect(await status("https://evil.example.com")).toBe(403);
    expect(await status("http://localhost:5173")).toBe(200);
    await server.close();
  });

  it("getHandler with only allowedOrigins validates Origin but not Host", async () => {
    const server = minimalServer({ allowedOrigins: ["app.example.com"] });
    const handler = server.getHandler();
    const ok = await handler(
      toolsListRequest({
        host: "anything.example.com",
        origin: "https://app.example.com",
      })
    );
    expect(ok.status).toBe(200);
    const rejected = await handler(
      toolsListRequest({
        host: "anything.example.com",
        origin: "https://evil.example.com",
      })
    );
    expect(rejected.status).toBe(403);
    await server.close();
  });

  it("listen with allowedHosts keeps accepting localhost (additive)", async () => {
    const server = minimalServer({ allowedHosts: ["api.example.com"] });
    const { url } = await server.listen(0);
    try {
      // node:http fills in Host as localhost:<port> when not overridden.
      expect(await rawStatus(url, {})).not.toBe(403);
      expect(await rawStatus(url, { host: "api.example.com" })).not.toBe(403);
      expect(await rawStatus(url, { host: "evil.example.com" })).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("listen on 0.0.0.0 without allowedHosts serves unvalidated, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = minimalServer({ host: "0.0.0.0" });
    try {
      const { url } = await server.listen(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("without Host validation")
      );
      expect(await rawStatus(url, { host: "any.example.com" })).not.toBe(403);
    } finally {
      warn.mockRestore();
      await server.close();
    }
  });

  it("rejects a localhost listen() after getHandler() mounted without validation", async () => {
    const server = minimalServer();
    server.getHandler();
    await expect(server.listen(0)).rejects.toThrow(/after getHandler/);
    await server.close();
  });
});
