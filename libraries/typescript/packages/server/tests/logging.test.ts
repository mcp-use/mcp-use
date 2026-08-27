/**
 * Request-logging tests: the compact single-line format, error surfacing, level handling, and noise
 * skipping — driven through `MCPServer.fetch` with synthetic
 * 2026-07-28 requests, capturing `console.log`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MCPServer, requestLogger } from "../src/index.js";
import type { ServerConfig } from "../src/index.js";

/** The per-request `_meta` envelope every 2026-07-28 request carries. */
const MODERN_ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "raw-request",
    version: "0.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function buildServer(config: Partial<ServerConfig> = {}): MCPServer {
  const server = new MCPServer({
    name: "logging-test",
    version: "1.0.0",
    ...config,
  });
  server.tool(
    { name: "greet", inputSchema: z.object({ who: z.string() }) },
    async ({ who }) => ({ content: [{ type: "text", text: `hi ${who}` }] })
  );
  server.tool(
    { name: "fail", inputSchema: z.object({ reason: z.string() }) },
    async ({ reason }) => ({
      content: [{ type: "text", text: `failed: ${reason}` }],
      isError: true,
    })
  );
  server.resource(
    { name: "config", uri: "config://settings" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "{}" }],
    })
  );
  server.prompt(
    { name: "standup", schema: z.object({ team: z.string() }) },
    async ({ team }) => ({
      messages: [
        { role: "user", content: { type: "text", text: `standup ${team}` } },
      ],
    })
  );
  return server;
}

/** Synthetic modern (2026-07-28) MCP request against server.fetch. */
function mcpRequest(
  method: string,
  params: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: MODERN_ENVELOPE },
    }),
  });
}

describe("requestLogger (via MCPServer.fetch)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Force deterministic output: no ANSI escapes, no env-level override.
    vi.stubEnv("NO_COLOR", "1");
    vi.stubEnv("MCP_USE_LOG_LEVEL", "");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  /** All captured console.log lines, flattened. */
  function loggedLines(): string[] {
    return (logSpy.mock.calls as unknown[][])
      .map((call) => call.map(String).join(" "))
      .flatMap((entry) => entry.split("\n"));
  }

  it("logs one complete MCP record for tools/call", async () => {
    const server = buildServer();
    const response = await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "world" } },
        { "mcp-name": "greet" }
      )
    );
    expect(response.status).toBe(200);

    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2} tools\/call greet \/mcp 200 client=raw-request\/0\.0\.0 \d+ms$/
    );
    await server.close();
  });

  it("echoes inline input/output at debug level", async () => {
    const server = buildServer({ logging: { level: "debug" } });
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "world" } },
        { "mcp-name": "greet" }
      )
    );
    const lines = loggedLines();
    // debug adds inline payloads but no trace dump.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      "tools/call greet /mcp 200 client=raw-request/0.0.0"
    );
    expect(lines[0]).toContain('{"who":"world"} -> "hi world"');
    await server.close();
  });

  it("truncates long inline input at debug level", async () => {
    const server = buildServer({ logging: { level: "debug" } });
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "x".repeat(200) } },
        { "mcp-name": "greet" }
      )
    );
    const detail = loggedLines()[0] ?? "";
    expect(detail).toContain('{"who":"xxx');
    expect(detail).toContain("...");
    // 80-char cap plus the ellipsis.
    const inputSegment =
      detail.split(" ").find((part) => part.startsWith('{"who"')) ?? "";
    expect(inputSegment.length).toBeLessThanOrEqual(83);
    await server.close();
  });

  it("logs the resource URI for resources/read", async () => {
    const server = buildServer();
    await server.fetch(
      mcpRequest(
        "resources/read",
        { uri: "config://settings" },
        { "mcp-name": "config://settings" }
      )
    );
    expect(loggedLines()[0]).toMatch(
      /resources\/read config:\/\/settings \/mcp 200 client=raw-request\/0\.0\.0 \d+ms/
    );
    await server.close();
  });

  it("logs the prompt name for prompts/get", async () => {
    const server = buildServer();
    await server.fetch(
      mcpRequest(
        "prompts/get",
        { name: "standup", arguments: { team: "core" } },
        { "mcp-name": "standup" }
      )
    );
    expect(loggedLines()[0]).toMatch(
      /prompts\/get standup \/mcp 200 client=raw-request\/0\.0\.0 \d+ms/
    );
    await server.close();
  });

  it("logs methods without a subject as the bare method name", async () => {
    const server = buildServer();
    await server.fetch(mcpRequest("tools/list", {}));
    expect(loggedLines()[0]).toMatch(
      /tools\/list \/mcp 200 client=raw-request\/0\.0\.0 \d+ms/
    );
    await server.close();
  });

  it("shows clientInfo as the initialize subject without repeating it", async () => {
    const server = buildServer();
    // Legacy handshake: initialize carries clientInfo in params, no envelope.
    await server.fetch(
      new Request("http://localhost/mcp", {
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
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "legacy-client", version: "2.1.0" },
          },
        }),
      })
    );
    expect(loggedLines()[0]).toMatch(
      /initialize legacy-client\/2\.1\.0 \/mcp 200 client=legacy-client\/2\.1\.0 \d+ms/
    );
    await server.close();
  });

  it("appends ERROR with the tool's message for isError results", async () => {
    const server = buildServer();
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "fail", arguments: { reason: "on purpose" } },
        { "mcp-name": "fail" }
      )
    );
    expect(loggedLines()[0]).toMatch(
      /tools\/call fail \/mcp 200 client=raw-request\/0\.0\.0 \d+ms ERROR failed: on purpose/
    );
    await server.close();
  });

  it("appends ERROR with the JSON-RPC error message for protocol errors", async () => {
    const server = buildServer();
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "no-such-tool", arguments: {} },
        { "mcp-name": "no-such-tool" }
      )
    );
    const detail = loggedLines()[0];
    expect(detail).toContain("tools/call no-such-tool /mcp");
    expect(detail).toMatch(/ERROR .*no-such-tool/);
    await server.close();
  });

  it("logs a single line for non-MCP requests", async () => {
    const server = buildServer();
    await server.fetch(
      new Request("http://localhost/health", { method: "GET" })
    );
    const lines = loggedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} GET \/health 404 \d+ms$/);
    await server.close();
  });

  it("uses the HTTP method for malformed and non-MCP endpoint bodies", async () => {
    const server = buildServer();
    await server.fetch(
      new Request("http://localhost/health", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
      })
    );
    await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(loggedLines()[0]).toMatch(
      /^\d{2}:\d{2}:\d{2} PATCH \/health 404 \d+ms$/
    );
    expect(loggedLines()[1]).toMatch(
      /^\d{2}:\d{2}:\d{2} POST \/mcp 400 \d+ms$/
    );
    await server.close();
  });

  it("labels JSON-RPC batches and missing client metadata without throwing", async () => {
    const server = buildServer();
    await server.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
          { jsonrpc: "2.0", id: 2, method: "prompts/list", params: {} },
        ]),
      })
    );
    expect(loggedLines()[0]).toMatch(
      /batch\(tools\/list,prompts\/list\) \/mcp \d+ client=unknown \d+ms/
    );
    await server.close();
  });

  it("adds an explicit source prefix only when one is configured", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    await requestLogger({ mcpPath: "/mcp", prefix: "[server]" })(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      async () => new Response(null, { status: 204 })
    );
    await requestLogger({ mcpPath: "/mcp" })(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
      async () => new Response(null, { status: 204 })
    );
    expect(loggedLines()[0]).toContain(
      "[server] tools/list /mcp 204 client=unknown"
    );
    expect(loggedLines()[1]).not.toContain("[server]");
  });

  it("logs a 500 single-line record before rethrowing a handler failure", async () => {
    await expect(
      requestLogger({ mcpPath: "/mcp" })(
        new Request("http://localhost/mcp", { method: "DELETE" }),
        async () => {
          throw new Error("socket closed");
        }
      )
    ).rejects.toThrow("socket closed");
    expect(loggedLines()[0]).toMatch(
      /DELETE \/mcp 500 \d+ms ERROR socket closed/
    );
  });

  it("logs unknown inspector paths and skips favicon noise", async () => {
    const server = buildServer();
    const handler = server.fetch;
    await handler(
      new Request("http://localhost/mcp/inspector", { method: "GET" })
    );
    await handler(
      new Request("http://localhost/favicon.ico", { method: "GET" })
    );
    expect(loggedLines()).toHaveLength(1);
    expect(loggedLines()[0]).toMatch(
      /^\d{2}:\d{2}:\d{2} GET \/mcp\/inspector 404 \d+ms$/
    );
    await server.close();
  });

  it("logs nothing when logging is disabled", async () => {
    const server = buildServer({ logging: { enabled: false } });
    const response = await server.fetch(mcpRequest("tools/list", {}));
    expect(response.status).toBe(200);
    expect(logSpy).not.toHaveBeenCalled();
    await server.close();
  });

  it("emits the full request/response dump at trace level", async () => {
    const server = buildServer({ logging: { level: "trace" } });
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "dump" } },
        { "mcp-name": "greet" }
      )
    );
    const output = loggedLines().join("\n");
    expect(output).toContain("[TRACE] Request Details");
    expect(output).toContain("Request Headers:");
    expect(output).toContain("Request Body:");
    expect(output).toContain("Response Body:");
    expect(output).toContain('"who": "dump"');
    // Trace includes debug's inline echo too.
    expect(output).toContain(
      "tools/call greet /mcp 200 client=raw-request/0.0.0"
    );
    expect(output).toContain('{"who":"dump"}');
    await server.close();
  });

  it("redacts credential headers in the trace dump", async () => {
    const server = buildServer({ logging: { level: "trace" } });
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "auth" } },
        { "mcp-name": "greet", authorization: "Bearer super-secret-token" }
      )
    );
    const output = loggedLines().join("\n");
    expect(output).toContain('"authorization": "[REDACTED]"');
    expect(output).not.toContain("super-secret-token");
    await server.close();
  });

  it("sanitizes control characters out of request-derived log text", async () => {
    const server = buildServer();
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "fail", arguments: { reason: "line1\nFORGED 200 OK" } },
        { "mcp-name": "fail" }
      )
    );
    const lines = loggedLines();
    // The injected newline must not produce a third log line.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("ERROR failed: line1 FORGED 200 OK");
    await server.close();
  });

  it("MCP_USE_LOG_LEVEL overrides the configured level", async () => {
    vi.stubEnv("MCP_USE_LOG_LEVEL", "trace");
    const server = buildServer();
    await server.fetch(mcpRequest("tools/list", {}));
    expect(loggedLines().join("\n")).toContain("[TRACE] Request Details");
    await server.close();
  });

  it("reads the pre-parsed body on the Host-validated path", async () => {
    // allowedHosts mounts via createMcpHonoApp, whose JSON middleware stashes
    // parsedBody in context vars — the logger must pick it up from there.
    const server = buildServer({ allowedHosts: ["api.example.com"] });
    await server.fetch(
      mcpRequest(
        "tools/call",
        { name: "greet", arguments: { who: "hono" } },
        { "mcp-name": "greet", host: "api.example.com" }
      )
    );
    expect(loggedLines()[0]).toMatch(
      /tools\/call greet \/mcp 200 client=raw-request\/0\.0\.0 \d+ms/
    );
    await server.close();
  });
});
