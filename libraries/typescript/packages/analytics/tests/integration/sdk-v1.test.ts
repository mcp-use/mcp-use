import { createHash } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { flush } from "../../src/index.js";
import { serveStateful, serveStateless } from "../helpers/fixtures-v1.js";
import type { TestServer } from "../helpers/http.js";
import { startIngest, type MockIngest } from "../helpers/ingest.js";
import {
  callSlowAndCancel,
  expectCancelledSlowCall,
  expectDashboardChangeReachesNextBatch,
  expectScenarioEvents,
  FIXTURE,
  NAMED_JWT,
  runScenarios,
} from "../helpers/scenarios.js";
import { byMethod, only, resetAnalytics } from "../helpers/state.js";

const KEY = "mfi_test_sdk_v1_0000000000000000000000000000";

async function connect(
  url: string,
  name: string,
  headers: Record<string, string> = {}
): Promise<Client> {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers },
    })
  );
  return client;
}

describe("SDK v1 McpServer over stateful streamable HTTP", () => {
  let ingest: MockIngest;
  let server: TestServer;

  beforeEach(async () => {
    ingest = await startIngest();
    server = await serveStateful({ apiKey: KEY, endpoint: ingest.url });
  });

  afterEach(async () => {
    await resetAnalytics();
    await server.close();
    await ingest.close();
  });

  it("records every request once, with session and client identity per client", async () => {
    const a = await connect(server.url, "client-a");
    const b = await connect(server.url, "client-b");
    await runScenarios(a);
    await runScenarios(b);
    await flush();
    await a.close();
    await b.close();

    const events = ingest.events();
    const sessions = new Set(events.map((e) => e.session_id));
    expect(sessions.size).toBe(2);

    for (const name of ["client-a", "client-b"]) {
      const mine = events.filter((e) => e.client?.name === name);
      expectScenarioEvents(mine, { unknownTool: "tool_error" });
      const init = only(mine, (e) => e.method === "initialize");
      expect(init.client_info).toMatchObject({ name, version: "1.0.0" });
      expect(init.protocol_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Set(mine.map((e) => e.session_id)).size).toBe(1);
      for (const event of mine) {
        expect(event.transport).toBe("streamable-http");
        expect(event.stateless).toBe(false);
        expect(event.http?.path).toBe("/mcp");
        expect(event.http?.host).toMatch(/^127\.0\.0\.1:\d+$/);
        expect(event.request_payload).toBeUndefined();
      }
      // Later requests carry the session's negotiated protocol version.
      expect(
        only(mine, (e) => e.method === "tools/list").protocol_version
      ).toBe(init.protocol_version);
    }
    expect(byMethod(events, "initialize")).toHaveLength(2);

    const batch = ingest.batches[0]!;
    expect(batch.schema).toBe("manufact.sdk.v1");
    expect(batch.sdk).toMatchObject({
      name: "@mcp-use/analytics",
      language: "typescript",
      framework: "mcp-sdk-v1",
    });
    expect(batch.sdk.runtime).toMatch(/^node\//);
    expect(batch.server).toEqual({ name: "fixture-v1", version: "1.2.3" });
    expect(
      ingest.requests.every((r) => r.authorization === `Bearer ${KEY}`)
    ).toBe(true);
  });

  it("records a call the client cancelled once, without an outcome", async () => {
    const client = await connect(server.url, "cancelling-client");
    // notifications/cancelled reaches the session's server and aborts the
    // handler's signal; the handler still returns 240 ms later.
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await client.callTool({
      name: FIXTURE.tools.echo,
      arguments: { text: "after" },
    });
    await flush();
    await client.close();

    const events = ingest.events();
    expectCancelledSlowCall(events);
    expect(only(events, (e) => e.target === FIXTURE.tools.echo).outcome).toBe(
      "success"
    );
    expect(
      events.find((e) => e.target === FIXTURE.tools.slow)?.session_id
    ).toBe(events.find((e) => e.target === FIXTURE.tools.echo)?.session_id);
  });

  it("skips requests that carry X-Gateway-Request-Id", async () => {
    const proxied = await connect(server.url, "via-gateway", {
      "x-gateway-request-id": "req_1",
    });
    const direct = await connect(server.url, "direct");
    await runScenarios(proxied);
    await direct.listTools();
    await flush();
    await proxied.close();
    await direct.close();

    const events = ingest.events();
    expect(events.some((e) => e.client?.name === "via-gateway")).toBe(false);
    expect(byMethod(events, "tools/list")).toHaveLength(1);
  });

  it("hashes the bearer token like the gateway and sends names only when allowed", async () => {
    ingest.config = { capture_payloads: false, identify_actors: true };
    const claims = {
      iss: "https://auth.example",
      sub: "user-1",
      name: "Ada",
      email: "ada@example.com",
    };
    const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    const client = await connect(server.url, "with-token", {
      authorization: `Bearer ${jwt}`,
    });
    await client.listTools();
    await flush();
    await client.close();

    const list = only(ingest.events(), (e) => e.method === "tools/list");
    expect(list.actor).toEqual({
      token_hash: createHash("sha256")
        .update("https://auth.example\0user-1")
        .digest("hex"),
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("applies a dashboard change to the first batch recorded a minute later", async () => {
    const client = await connect(server.url, "dashboard-change", {
      authorization: `Bearer ${NAMED_JWT}`,
    });
    await expectDashboardChangeReachesNextBatch(ingest, (args) =>
      client.callTool({ name: FIXTURE.tools.echo, arguments: args })
    );
    await client.close();
  });
});

describe("SDK v1 McpServer over stateless streamable HTTP", () => {
  let ingest: MockIngest;
  let server: TestServer;

  beforeEach(async () => {
    ingest = await startIngest();
    server = await serveStateless({ apiKey: KEY, endpoint: ingest.url });
  });

  afterEach(async () => {
    await resetAnalytics();
    await server.close();
    await ingest.close();
  });

  it("records per-request servers without a session and leaves client naming to the User-Agent", async () => {
    const client = await connect(server.url, "stateless-client");
    await runScenarios(client);
    await flush();
    await client.close();

    const events = ingest.events();
    expectScenarioEvents(events, { unknownTool: "tool_error" });
    const init = only(events, (e) => e.method === "initialize");
    expect(init.client).toEqual({ name: "stateless-client", version: "1.0.0" });
    for (const event of events) {
      expect(event.session_id).toBeUndefined();
      expect(event.stateless).toBe(true);
      expect(event.transport).toBe("streamable-http");
      if (event.method !== "initialize") expect(event.client).toBeUndefined();
    }
  });

  it("records a call the client cancelled once, without an outcome", async () => {
    const client = await connect(server.url, "cancelling-client");
    // The notification is its own POST, served by a fresh server instance.
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await flush();
    await client.close();

    const events = ingest.events();
    expectCancelledSlowCall(events);
    expect(byMethod(events, "notifications/cancelled")).toHaveLength(0);
  });

  it("cancels only the requester's own call when another client uses the same id", async () => {
    const mine = await connect(server.url, "mine", {
      authorization: "Bearer a",
    });
    const theirs = await connect(server.url, "theirs", {
      authorization: "Bearer b",
    });
    // Both clients number requests the same way: these two calls share an id.
    const other = theirs.callTool({ name: FIXTURE.tools.slow, arguments: {} });
    await callSlowAndCancel((signal) =>
      mine.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await other;
    await flush();
    await mine.close();
    await theirs.close();

    const slow = byMethod(ingest.events(), "tools/call").filter(
      (e) => e.target === FIXTURE.tools.slow
    );
    expect(slow).toHaveLength(2);
    expect(new Set(slow.map((e) => e.request_id)).size).toBe(1);
    expect(slow.map((e) => e.outcome ?? null).sort()).toEqual([
      null,
      "success",
    ]);
  });
});

describe("SDK v1 payload capture", () => {
  let ingest: MockIngest;
  const servers: TestServer[] = [];

  beforeEach(async () => {
    ingest = await startIngest({
      capture_payloads: true,
      identify_actors: false,
    });
  });

  afterEach(async () => {
    await resetAnalytics();
    await Promise.all(servers.splice(0).map((s) => s.close()));
    await ingest.close();
  });

  it("sends redacted payloads when the dashboard turns capture on", async () => {
    const server = await serveStateful({ apiKey: KEY, endpoint: ingest.url });
    servers.push(server);
    const client = await connect(server.url, "capture-on");
    await client.callTool({
      name: "echo",
      arguments: { text: "hi", api_key: "sk-123" },
    });
    await client.listTools();
    await flush();
    await client.close();

    const events = ingest.events();
    const echo = only(events, (e) => e.target === "echo");
    expect(echo.request_payload).toMatchObject({
      method: "tools/call",
      params: {
        name: "echo",
        arguments: { text: "hi", api_key: "[REDACTED]" },
      },
    });
    expect(echo.response_payload).toMatchObject({
      result: { content: [{ type: "text", text: "echo: hi" }] },
    });
    expect(
      only(events, (e) => e.method === "tools/list").response_payload
    ).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "echo" }),
        ]),
      },
    });
  });

  it("never sends payloads with capturePayloads: false", async () => {
    const server = await serveStateful({
      apiKey: KEY,
      endpoint: ingest.url,
      capturePayloads: false,
    });
    servers.push(server);
    const client = await connect(server.url, "capture-off");
    await client.callTool({ name: "echo", arguments: { text: "hi" } });
    await flush();
    await client.close();

    const events = ingest.events();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.request_payload).toBeUndefined();
      expect(event.response_payload).toBeUndefined();
    }
  });
});
