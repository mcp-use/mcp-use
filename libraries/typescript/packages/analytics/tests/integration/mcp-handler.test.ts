import {
  Client as ClientV2,
  StreamableHTTPClientTransport as TransportV2,
} from "@modelcontextprotocol/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpHandler } from "mcp-handler";

import { flush, instrument } from "../../src/index.js";
import { registerV2Fixture } from "../helpers/fixtures-v2.js";
import { listenFetch, type TestServer } from "../helpers/http.js";
import { startIngest, type MockIngest } from "../helpers/ingest.js";
import {
  callSlowAndCancel,
  expectCancelledSlowCall,
  expectScenarioEvents,
  FIXTURE,
  runScenarios,
} from "../helpers/scenarios.js";
import { only, resetAnalytics } from "../helpers/state.js";

const KEY = "mfi_test_mcp_handler_0000000000000000000000000";

describe("Vercel mcp-handler", () => {
  let ingest: MockIngest;
  let server: TestServer;
  const waited: Promise<unknown>[] = [];

  beforeEach(async () => {
    ingest = await startIngest();
    // Vercel installs its request context on globalThis; the SDK hands the
    // pending flush to its waitUntil.
    (globalThis as Record<symbol, unknown>)[
      Symbol.for("@vercel/request-context")
    ] = {
      get: () => ({
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      }),
    };
    const handler = createMcpHandler((mcp) => {
      instrument(mcp, { apiKey: KEY, endpoint: ingest.url });
      registerV2Fixture(mcp);
    });
    server = await listenFetch((request) => handler(request));
  });

  afterEach(async () => {
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for("@vercel/request-context")
    ];
    await resetAnalytics();
    await server.close();
    await ingest.close();
  });

  it("records each per-request server and flushes through Vercel's waitUntil", async () => {
    const client = new Client({ name: "vercel-client", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    );
    await runScenarios(client);
    await client.close();

    // No explicit flush: the promises handed to waitUntil deliver everything.
    expect(waited.length).toBeGreaterThan(0);
    await Promise.all(waited);
    const events = ingest.events();
    expectScenarioEvents(events, { unknownTool: "error" });
    expect(only(events, (e) => e.method === "initialize").client?.name).toBe(
      "vercel-client"
    );
    expect(ingest.batches[0]?.sdk.framework).toBe("mcp-handler");
    await flush();
  });

  it("records a cancelled call once, without an outcome, from 2026-07-28 and legacy clients", async () => {
    // A 2026-07-28 client aborts the HTTP request.
    const modern = new ClientV2(
      { name: "modern-client", version: "2.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    await modern.connect(new TransportV2(new URL(`${server.url}/mcp`)));
    await callSlowAndCancel((signal) =>
      modern.callTool({ name: FIXTURE.tools.slow, arguments: {} }, { signal })
    );
    await modern.close();
    await flush();
    expectCancelledSlowCall(ingest.events());

    // A legacy client POSTs notifications/cancelled to a fresh instance.
    ingest.batches.length = 0;
    const legacy = new Client({ name: "legacy-client", version: "1.0.0" });
    await legacy.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    );
    await callSlowAndCancel((signal) =>
      legacy.callTool({ name: FIXTURE.tools.slow, arguments: {} }, undefined, {
        signal,
      })
    );
    await legacy.close();
    await flush();
    expectCancelledSlowCall(ingest.events());
  });
});
