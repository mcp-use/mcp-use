import {
  Client as ClientV2,
  StreamableHTTPClientTransport as TransportV2,
} from "@modelcontextprotocol/client";
import { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as TransportV1 } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { flush, instrument } from "../../src/index.js";
import { registerV2Fixture } from "../helpers/fixtures-v2.js";
import { listenFetch, type TestServer } from "../helpers/http.js";
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

const KEY = "mfi_test_sdk_v2_0000000000000000000000000000";

/** A 2026-07-28 client (v2 clients default to the 2025 handshake). */
function modernClient(name: string, version: string): ClientV2 {
  return new ClientV2(
    { name, version },
    { versionNegotiation: { mode: "auto" } }
  );
}

describe("SDK v2 McpServer behind createMcpHandler", () => {
  let ingest: MockIngest;
  let server: TestServer;
  let built = 0;

  beforeEach(async () => {
    ingest = await startIngest({
      capture_payloads: true,
      identify_actors: false,
    });
    const handler = createMcpHandler(() => {
      built += 1;
      // A fresh server per request, instrumented before registration.
      const mcp = new McpServer({ name: "fixture-v2", version: "2.0.0" });
      instrument(mcp, { apiKey: KEY, endpoint: ingest.url });
      return registerV2Fixture(mcp);
    });
    server = await listenFetch((request) => handler.fetch(request));
  });

  afterEach(async () => {
    await resetAnalytics();
    await server.close();
    await ingest.close();
  });

  it("reads 2026-07-28 client identity from the per-request envelope", async () => {
    const client = modernClient("modern-client", "3.1.0");
    await client.connect(new TransportV2(new URL(`${server.url}/mcp`)));
    await runScenarios(client);
    await flush();
    await client.close();

    const events = ingest
      .events()
      .filter((e) => e.method !== "server/discover");
    expectScenarioEvents(events, { unknownTool: "error" });
    expect(byMethod(events, "initialize")).toHaveLength(0);
    for (const event of events) {
      expect(event.client).toEqual({ name: "modern-client", version: "3.1.0" });
      expect(event.protocol_version).toBe("2026-07-28");
      expect(event.stateless).toBe(true);
      expect(event.transport).toBe("streamable-http");
      expect(event.session_id).toBeUndefined();
      expect(event.http?.method).toBe("POST");
    }
    expect(ingest.batches[0]?.sdk.framework).toBe("mcp-sdk-v2");
    expect(ingest.batches[0]?.server).toEqual({
      name: "fixture-v2",
      version: "2.0.0",
    });
    expect(built).toBeGreaterThan(5);

    // Payload capture is on in the dashboard settings of this mock.
    const echo = only(events, (e) => e.target === "echo");
    expect(echo.request_payload).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hi" } },
    });
    expect(echo.response_payload).toMatchObject({
      result: { content: [{ type: "text", text: "echo: hi" }] },
    });
  });

  it("serves two eras side by side and keeps each client's name", async () => {
    const modern = modernClient("modern-client", "3.1.0");
    await modern.connect(new TransportV2(new URL(`${server.url}/mcp`)));
    const legacy = new ClientV1({ name: "legacy-client", version: "1.0.0" });
    await legacy.connect(new TransportV1(new URL(`${server.url}/mcp`)));
    await modern.listTools();
    await legacy.listTools();
    await flush();
    await modern.close();
    await legacy.close();

    const events = ingest.events();
    const init = only(events, (e) => e.method === "initialize");
    expect(init.client).toEqual({ name: "legacy-client", version: "1.0.0" });
    expect(init.client_info).toMatchObject({ name: "legacy-client" });
    const lists = byMethod(events, "tools/list");
    expect(lists).toHaveLength(2);
    expect(lists.map((e) => e.client?.name ?? null).sort()).toEqual(
      [null, "modern-client"].sort()
    );
    // The legacy stateless request has no session and no client: the edge
    // names it from the User-Agent.
    const legacyList = lists.find((e) => e.client === undefined)!;
    expect(legacyList.http?.user_agent).toBeDefined();
  });

  it("records a call a 2026-07-28 client cancelled (HTTP abort) once, without an outcome", async () => {
    const client = modernClient("modern-client", "3.1.0");
    await client.connect(new TransportV2(new URL(`${server.url}/mcp`)));
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, { signal })
    );
    await flush();
    await client.close();

    const events = ingest.events();
    expectCancelledSlowCall(events);
    expect(
      only(events, (e) => e.target === FIXTURE.tools.slow).protocol_version
    ).toBe("2026-07-28");
  });

  it("records a call a legacy client cancelled (notifications/cancelled) once, without an outcome", async () => {
    const client = new ClientV1({ name: "legacy-client", version: "1.0.0" });
    await client.connect(new TransportV1(new URL(`${server.url}/mcp`)));
    await callSlowAndCancel((signal) =>
      client.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await flush();
    await client.close();

    expectCancelledSlowCall(ingest.events());
  });

  it("applies a dashboard change to the first batch recorded a minute later", async () => {
    const client = modernClient("dashboard-change", "1.0.0");
    await client.connect(
      new TransportV2(new URL(`${server.url}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${NAMED_JWT}` } },
      })
    );
    await expectDashboardChangeReachesNextBatch(ingest, (args) =>
      client.callTool({ name: FIXTURE.tools.echo, arguments: args })
    );
    await client.close();
  });
});
