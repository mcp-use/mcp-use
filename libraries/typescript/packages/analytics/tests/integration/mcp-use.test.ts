import {
  Client as ClientV2,
  StreamableHTTPClientTransport as TransportV2,
} from "@modelcontextprotocol/client";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCPServer } from "mcp-use";
import { z } from "zod";

import { flush, instrument } from "../../src/index.js";
import type { AnalyticsOptions } from "../../src/types.js";
import { startIngest, type MockIngest } from "../helpers/ingest.js";
import {
  callSlowAndCancel,
  expectCancelledSlowCall,
  expectScenarioEvents,
  FIXTURE,
  runScenarios,
  SLOW_MS,
  slowReturned,
  slowTool,
} from "../helpers/scenarios.js";
import { byMethod, only, resetAnalytics } from "../helpers/state.js";

const KEY = "mfi_test_mcp_use_000000000000000000000000000000";

function mcpUseServer(options?: AnalyticsOptions): MCPServer {
  const server = new MCPServer({ name: "fixture-mcp-use", version: "4.0.0" });
  if (options !== undefined) {
    instrument(server, options);
    instrument(server, options);
  }
  server.tool(
    { name: FIXTURE.tools.echo, inputSchema: z.object({ text: z.string() }) },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] })
  );
  server.tool(
    { name: FIXTURE.tools.fail, inputSchema: z.object({}) },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "bad input" }],
    })
  );
  server.tool(
    { name: FIXTURE.tools.explode, inputSchema: z.object({}) },
    async () => {
      throw new Error("kaput");
    }
  );
  server.tool(
    { name: FIXTURE.tools.slow, inputSchema: z.object({}) },
    async () => ({ content: [{ type: "text", text: await slowTool() }] })
  );
  server.resource({ name: "note", uri: FIXTURE.resourceUri }, async () => ({
    contents: [{ uri: FIXTURE.resourceUri, text: "hello" }],
  }));
  server.prompt(
    { name: FIXTURE.prompt, schema: z.object({ name: z.string() }) },
    async ({ name }) => ({
      messages: [
        { role: "user", content: { type: "text", text: `Hello ${name}` } },
      ],
    })
  );
  return server;
}

describe("mcp-use MCPServer", () => {
  let ingest: MockIngest;
  let server: MCPServer | undefined;

  beforeEach(async () => {
    ingest = await startIngest({
      capture_payloads: true,
      identify_actors: false,
    });
  });

  afterEach(async () => {
    await resetAnalytics();
    await server?.close();
    server = undefined;
    await ingest.close();
  });

  it("records hooked methods from middleware and the rest from the HTTP layer", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    const { url } = await server.listen(0);

    const legacy = new ClientV1({ name: "legacy-client", version: "1.0.0" });
    await legacy.connect(new TransportV1(new URL(url)));
    const modern = new ClientV2(
      { name: "modern-client", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    await modern.connect(new TransportV2(new URL(url)));
    await runScenarios(legacy);
    await runScenarios(modern);
    await flush();
    await legacy.close();
    await modern.close();

    const events = ingest.events();
    const modernEvents = events.filter(
      (e) => e.client?.name === "modern-client"
    );
    expectScenarioEvents(
      modernEvents.filter((e) => e.method !== "server/discover"),
      { unknownTool: "error" }
    );
    for (const event of modernEvents) {
      expect(event.protocol_version).toBe("2026-07-28");
      expect(event.stateless).toBe(true);
      expect(event.http?.status).toBe(200);
      expect(event.http?.path).toBe("/mcp");
    }

    // Legacy stateless traffic: only initialize names the client.
    const init = only(events, (e) => e.method === "initialize");
    expect(init.client).toEqual({ name: "legacy-client", version: "1.0.0" });
    expect(init.client_info).toMatchObject({ name: "legacy-client" });
    expect(init.outcome).toBe("success");
    expect(init.protocol_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const legacyEvents = events.filter(
      (e) => e.client === undefined && e.method !== "notifications/initialized"
    );
    expectScenarioEvents(legacyEvents, { unknownTool: "error" });

    // Payload capture is on: list results are rebuilt into protocol envelopes.
    const list = byMethod(modernEvents, "tools/list")[0]!;
    expect(list.response_payload).toMatchObject({
      result: { tools: expect.any(Array) },
    });
    const unknown = only(
      modernEvents,
      (e) => e.target === FIXTURE.tools.unknown
    );
    expect(unknown.response_payload).toMatchObject({ error: { code: -32602 } });

    expect(ingest.batches.every((b) => b.sdk.framework === "mcp-use")).toBe(
      true
    );
    expect(
      ingest.batches.some((b) => b.server?.name === "fixture-mcp-use")
    ).toBe(true);
  });

  it("records a resources/read once when mcp-use normalizes its URI", async () => {
    server = new MCPServer({ name: "uris", version: "1.0.0" });
    instrument(server, { apiKey: KEY, endpoint: ingest.url });
    server.resource(
      { name: "home", uri: "https://example.com/" },
      async () => ({
        contents: [{ uri: "https://example.com/", text: "home" }],
      })
    );
    server.resourceTemplate(
      { name: "note", uriTemplate: "notes://{id}" },
      async (uri, params) => ({
        contents: [{ uri: uri.href, text: String(params.id) }],
      })
    );
    const { url } = await server.listen(0);
    const client = new ClientV1({ name: "uri-client", version: "1.0.0" });
    await client.connect(new TransportV1(new URL(url)));
    // mcp-use hands its middleware `https://example.com/` and
    // `notes://caf%C3%A9` for these.
    await client.readResource({ uri: "https://example.com" });
    await client.readResource({ uri: "notes://café" });
    await flush();
    await client.close();

    const reads = byMethod(ingest.events(), "resources/read");
    expect(reads.map((e) => [e.target, e.outcome])).toEqual([
      ["https://example.com", "success"],
      ["notes://café", "success"],
    ]);
    for (const read of reads) expect(read.request_id).toBeDefined();
  });

  it("records the outcome the client received when the result fails validation after the middleware", async () => {
    server = new MCPServer({ name: "schemas", version: "1.0.0" });
    instrument(server, { apiKey: KEY, endpoint: ingest.url });
    const outputSchema = z.object({ temp: z.number() });
    server.tool(
      { name: "weather", inputSchema: z.object({}), outputSchema },
      async () =>
        ({
          content: [{ type: "text", text: "hot" }],
          structuredContent: { temp: "hot" },
        }) as never
    );
    server.tool(
      { name: "fine", inputSchema: z.object({}), outputSchema },
      async () => ({
        content: [{ type: "text", text: "21" }],
        structuredContent: { temp: 21 },
      })
    );
    const { url } = await server.listen(0);
    const client = new ClientV1({ name: "schema-client", version: "1.0.0" });
    await client.connect(new TransportV1(new URL(url)));
    const bad = await client.callTool({ name: "weather", arguments: {} });
    expect(bad.isError).toBe(true);
    await client.callTool({ name: "fine", arguments: {} });
    await flush();
    await client.close();

    const calls = byMethod(ingest.events(), "tools/call");
    const weather = only(calls, (e) => e.target === "weather");
    expect(weather.outcome).toBe("tool_error");
    expect(weather.error?.message).toMatch(/structured content|validation/i);
    expect(weather.response_payload).toMatchObject({
      result: { isError: true },
    });
    expect(weather.request_id).toBeDefined();
    expect(weather.duration_ms).toBeGreaterThanOrEqual(0);
    const fine = only(calls, (e) => e.target === "fine");
    expect(fine.outcome).toBe("success");
    expect(fine.response_payload).toMatchObject({
      result: { structuredContent: { temp: 21 } },
    });
  });

  it("records an HTTP failure without a JSON-RPC reply as an error without a JSON-RPC code", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    server.use(
      async (
        c: { req: { header(name: string): string | undefined } } & {
          text(body: string, status: number): Response;
        },
        next: () => Promise<void>
      ) => {
        if (c.req.header("x-break") === "1") {
          return c.text("upstream exploded", 502);
        }
        await next();
        return undefined;
      }
    );
    const { url } = await server.listen(0);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-break": "1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/list",
        params: {},
      }),
    });
    expect(response.status).toBe(502);
    await response.text();
    await flush();

    const event = only(ingest.events(), (e) => e.method === "tools/list");
    expect(event).toMatchObject({
      request_id: 42,
      outcome: "error",
      error: { message: "HTTP 502" },
      http: { status: 502 },
    });
    expect(event.error).not.toHaveProperty("code");
    expect(event.response_size).toBeUndefined();
  });

  it("records a call a 2026-07-28 client cancelled (HTTP abort) once, without an outcome", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    const { url } = await server.listen(0);
    const client = new ClientV2(
      { name: "modern-client", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    await client.connect(new TransportV2(new URL(url)));
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, { signal })
    );
    await client.callTool({
      name: FIXTURE.tools.echo,
      arguments: { text: "x" },
    });
    await flush();
    await client.close();

    const events = ingest.events();
    expectCancelledSlowCall(events);
    const slow = only(events, (e) => e.target === FIXTURE.tools.slow);
    expect(slow.client).toEqual({ name: "modern-client", version: "2.0.0" });
    expect(slow.protocol_version).toBe("2026-07-28");
    expect(only(events, (e) => e.target === FIXTURE.tools.echo).outcome).toBe(
      "success"
    );
  });

  it("records a call a legacy client cancelled (notifications/cancelled) once, without an outcome", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    const { url } = await server.listen(0);
    const client = new ClientV1({ name: "legacy-client", version: "1.0.0" });
    await client.connect(new TransportV1(new URL(url)));
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await flush();
    await client.close();

    expectCancelledSlowCall(ingest.events());
  });

  it("records a request once when the response ends before its handler does", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    // A timeout middleware answers 504 while the tool keeps running.
    server.use(
      async (
        c: { req: { header(name: string): string | undefined } } & {
          text(body: string, status: number): Response;
        },
        next: () => Promise<void>
      ) => {
        if (c.req.header("x-deadline") !== "1") {
          await next();
          return undefined;
        }
        const timedOut = await Promise.race([
          next().then(() => false),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(true), 50)
          ),
        ]);
        return timedOut ? c.text("deadline exceeded", 504) : undefined;
      }
    );
    const { url } = await server.listen(0);
    // A 2026-07-28 exchange: mcp-use answers once the handler settled.
    const client = new ClientV2(
      { name: "modern-client", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    await client.connect(
      new TransportV2(new URL(url), {
        requestInit: { headers: { "x-deadline": "1" } },
      })
    );
    const returned = slowReturned();
    await expect(
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} })
    ).rejects.toThrow(/deadline exceeded/);
    await returned;
    await flush();
    await client.close();

    const event = only(ingest.events(), (e) => e.method === "tools/call");
    expect(event).toMatchObject({
      target: FIXTURE.tools.slow,
      outcome: "error",
      error: { message: "HTTP 504" },
      http: { status: 504 },
    });
    expect(event.duration_ms).toBeLessThan(SLOW_MS);
  });

  it("skips requests that carry X-Gateway-Request-Id", async () => {
    server = mcpUseServer({ apiKey: KEY, endpoint: ingest.url });
    const { url } = await server.listen(0);
    const client = new ClientV1({ name: "via-gateway", version: "1.0.0" });
    await client.connect(
      new TransportV1(new URL(url), {
        requestInit: { headers: { "x-gateway-request-id": "req_9" } },
      })
    );
    await runScenarios(client);
    await flush();
    await client.close();
    expect(ingest.events()).toHaveLength(0);
  });

  it("warns and records nothing when instrument() runs after listen()", async () => {
    server = mcpUseServer();
    const { url } = await server.listen(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    instrument(server, { apiKey: KEY, endpoint: ingest.url });
    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes("before listen()")
      )
    ).toBe(true);
    warn.mockRestore();

    const client = new ClientV1({ name: "late", version: "1.0.0" });
    await client.connect(new TransportV1(new URL(url)));
    await client.listTools();
    await flush();
    await client.close();
    expect(ingest.events()).toHaveLength(0);
  });
});
