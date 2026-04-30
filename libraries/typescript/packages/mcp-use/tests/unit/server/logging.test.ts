import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";

import { getDebugLevel, requestLogger } from "../../../src/server/logging.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockOptions {
  method?: string;
  url?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
  responseContentType?: string;
}

function makeContext(opts: MockOptions = {}): {
  ctx: Context;
  next: Next;
  // Captured for assertions:
  state: { lastResponse: Response };
} {
  const method = opts.method ?? "POST";
  const url = opts.url ?? "http://localhost:3000/mcp";
  const headers = new Headers(opts.requestHeaders ?? {});

  const requestInit: RequestInit = {
    method,
    headers,
  };
  if (opts.requestBody !== undefined && method !== "GET" && method !== "HEAD") {
    requestInit.body =
      typeof opts.requestBody === "string"
        ? opts.requestBody
        : JSON.stringify(opts.requestBody);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }

  const rawRequest = new Request(url, requestInit);

  const responseHeaders = new Headers(opts.responseHeaders ?? {});
  if (opts.responseContentType && !responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", opts.responseContentType);
  }
  const response = new Response(opts.responseBody ?? null, {
    status: opts.responseStatus ?? 200,
    headers: responseHeaders,
  });

  const state = { lastResponse: response };

  // Minimal Hono Context shim covering what requestLogger reads.
  const ctx = {
    req: {
      raw: rawRequest,
      method,
      url,
      header(name?: string): any {
        if (name === undefined) {
          const all: Record<string, string> = {};
          headers.forEach((v, k) => {
            all[k] = v;
          });
          return all;
        }
        return headers.get(name) ?? undefined;
      },
      path: new URL(url).pathname,
    },
    get res(): Response {
      return state.lastResponse;
    },
  } as unknown as Context;

  const next: Next = async () => {
    // Replace the response inside next() to simulate a downstream handler.
    state.lastResponse = response;
  };

  return { ctx, next, state };
}

// ---------------------------------------------------------------------------
// getDebugLevel
// ---------------------------------------------------------------------------

describe("getDebugLevel", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to info when no env vars are set", () => {
    delete process.env.MCP_DEBUG_LEVEL;
    delete process.env.DEBUG;
    expect(getDebugLevel()).toBe("info");
  });

  it("respects MCP_DEBUG_LEVEL=debug", () => {
    process.env.MCP_DEBUG_LEVEL = "debug";
    expect(getDebugLevel()).toBe("debug");
  });

  it("respects MCP_DEBUG_LEVEL=trace", () => {
    process.env.MCP_DEBUG_LEVEL = "trace";
    expect(getDebugLevel()).toBe("trace");
  });

  it("normalizes case and whitespace", () => {
    process.env.MCP_DEBUG_LEVEL = "  TRACE  ";
    expect(getDebugLevel()).toBe("trace");
  });

  it("falls back to info for unknown MCP_DEBUG_LEVEL values", () => {
    process.env.MCP_DEBUG_LEVEL = "verbose";
    delete process.env.DEBUG;
    expect(getDebugLevel()).toBe("info");
  });

  it("maps legacy DEBUG=1 to trace", () => {
    delete process.env.MCP_DEBUG_LEVEL;
    process.env.DEBUG = "1";
    expect(getDebugLevel()).toBe("trace");
  });

  it("maps legacy DEBUG=true to trace", () => {
    delete process.env.MCP_DEBUG_LEVEL;
    process.env.DEBUG = "true";
    expect(getDebugLevel()).toBe("trace");
  });

  it("treats DEBUG=0 as disabled", () => {
    delete process.env.MCP_DEBUG_LEVEL;
    process.env.DEBUG = "0";
    expect(getDebugLevel()).toBe("info");
  });

  it("treats DEBUG=false as disabled", () => {
    delete process.env.MCP_DEBUG_LEVEL;
    process.env.DEBUG = "false";
    expect(getDebugLevel()).toBe("info");
  });

  it("MCP_DEBUG_LEVEL takes precedence over DEBUG", () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    process.env.DEBUG = "1";
    expect(getDebugLevel()).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// requestLogger
// ---------------------------------------------------------------------------

describe("requestLogger", () => {
  const originalEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  function logLines(): string[] {
    return logSpy.mock.calls.map((c) => String(c[0]));
  }

  it("emits info-level line for initialize with client info and new session id", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const sid = "92c4e0b1-1234-5678-9abc-def012345678";
    const { ctx, next } = makeContext({
      method: "POST",
      url: "http://localhost:3000/mcp",
      requestBody: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "log-demo", version: "0.1.0" } },
      },
      responseStatus: 200,
      responseHeaders: { "mcp-session-id": sid },
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("POST");
    expect(line).toContain("/mcp");
    expect(line).toContain("[initialize: log-demo/0.1.0]");
    expect(line).toContain("→ session=92c4e0b");
    expect(line).toContain("OK");
    expect(line).toMatch(/\(\d+ms\)/);
    // Initialize lines must NOT carry an incoming sess= prefix.
    expect(line).not.toMatch(/sess=\S+ POST/);
  });

  it("prefixes non-initialize requests with sess=<short>", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const sid = "92c4e0b1-1234-5678-9abc-def012345678";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": sid },
      requestBody: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("sess=92c4e0b");
    expect(line).toContain("[tools/list]");
    expect(line).toContain("OK");
  });

  it("at info level, tools/call shows tool name but no args", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "Andrew", formal: true } },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 3, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("[tools/call: greet]");
    expect(line).not.toContain("args=");
  });

  it("at debug level, tools/call appends args=<json>", async () => {
    process.env.MCP_DEBUG_LEVEL = "debug";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "greet", arguments: { name: "Andrew", formal: true } },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 4, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("[tools/call: greet]");
    expect(line).toContain('args={"name":"Andrew","formal":true}');
  });

  it("resources/read shows the resource URI", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 10,
        method: "resources/read",
        params: { uri: "ui://widget/weather-display.html" },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 10, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain(
      "[resources/read: ui://widget/weather-display.html]"
    );
    expect(line).toContain("OK");
  });

  it("prompts/get shows the prompt name", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 11,
        method: "prompts/get",
        params: { name: "summarize" },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 11, result: {} }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("[prompts/get: summarize]");
    expect(line).toContain("OK");
  });

  it("extracts JSON-RPC error message from response body", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "does-not-exist" },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        error: {
          code: -32602,
          message: "MCP error -32602: Tool does-not-exist not found",
        },
      }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain(
      "ERROR MCP error -32602: Tool does-not-exist not found"
    );
  });

  it("extracts tool error text from result.isError responses", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "divide", arguments: { a: 10, b: 0 } },
      },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        result: {
          isError: true,
          content: [{ type: "text", text: "cannot divide by zero" }],
        },
      }),
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("ERROR cannot divide by zero");
  });

  it("parses errors from text/event-stream (SSE) responses", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const sseBody =
      `event: message\n` +
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32601, message: "Method not found" },
      })}\n\n`;

    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: { jsonrpc: "2.0", id: 7, method: "tools/list" },
      responseStatus: 200,
      responseContentType: "text/event-stream",
      responseBody: sseBody,
    });

    await requestLogger(ctx, next);

    const line = logLines()[0];
    expect(line).toContain("ERROR Method not found");
  });

  it("skips noisy paths (no log line emitted)", async () => {
    process.env.MCP_DEBUG_LEVEL = "info";
    const { ctx, next } = makeContext({
      method: "POST",
      url: "http://localhost:3000/inspector/api/tel/event",
      responseStatus: 200,
    });

    await requestLogger(ctx, next);
    expect(logLines()).toHaveLength(0);
  });

  it("trace level emits the summary line plus a detailed dump", async () => {
    process.env.MCP_DEBUG_LEVEL = "trace";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: { jsonrpc: "2.0", id: 8, method: "tools/list" },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 8, result: {} }),
    });

    await requestLogger(ctx, next);

    const lines = logLines();
    // Summary line first, then a multi-line trace dump
    expect(lines[0]).toContain("[tools/list]");
    expect(lines.some((l) => l.includes("TRACE"))).toBe(true);
    expect(lines.some((l) => l.includes("Request Body"))).toBe(true);
    expect(lines.some((l) => l.includes("Response Body"))).toBe(true);
  });

  it("DEBUG=1 acts as trace (backward compatibility)", async () => {
    delete process.env.MCP_DEBUG_LEVEL;
    process.env.DEBUG = "1";
    const { ctx, next } = makeContext({
      requestHeaders: { "mcp-session-id": "abcdefg" },
      requestBody: { jsonrpc: "2.0", id: 9, method: "tools/list" },
      responseStatus: 200,
      responseContentType: "application/json",
      responseBody: JSON.stringify({ jsonrpc: "2.0", id: 9, result: {} }),
    });

    await requestLogger(ctx, next);

    const lines = logLines();
    expect(lines.some((l) => l.includes("TRACE"))).toBe(true);
  });
});
