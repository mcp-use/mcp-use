import {
  Client as ClientV2,
  StreamableHTTPClientTransport as TransportV2,
} from "@modelcontextprotocol/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Skybridge, type McpServer } from "skybridge/server";
import { z } from "zod";

import { flush, instrument } from "../../src/index.js";
import type { AnalyticsOptions } from "../../src/types.js";
import { registerV2Fixture } from "../helpers/fixtures-v2.js";
import { listenFetch, type TestServer } from "../helpers/http.js";
import { startIngest, type MockIngest } from "../helpers/ingest.js";
import {
  callSlowAndCancel,
  expectCancelledSlowCall,
  expectScenarioEvents,
  FIXTURE,
  runScenarios,
  slowTool,
} from "../helpers/scenarios.js";
import { only, resetAnalytics } from "../helpers/state.js";

const KEY = "mfi_test_skybridge_000000000000000000000000000";

function registerSkybridgeTools(server: McpServer): McpServer {
  server
    .registerTool(
      { name: FIXTURE.tools.echo, inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: `echo: ${text}` })
    )
    .registerTool({ name: FIXTURE.tools.fail }, async () => ({
      content: "bad input",
      isError: true,
    }))
    .registerTool({ name: FIXTURE.tools.explode }, async () => {
      throw new Error("kaput");
    })
    .registerTool({ name: FIXTURE.tools.slow }, async () => ({
      content: await slowTool(),
    }));
  registerV2Fixture(
    server as unknown as Parameters<typeof registerV2Fixture>[0],
    false
  );
  return server;
}

/** Serve a Skybridge app the way its own `/mcp` route does. */
async function serve(app: Skybridge): Promise<TestServer> {
  const handler = createMcpHandler(() => app.createServerInstance());
  return listenFetch((request) => handler.fetch(request));
}

async function exercise(url: string, name: string): Promise<void> {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
  );
  await runScenarios(client);
  await client.close();
}

describe("Skybridge", () => {
  let ingest: MockIngest;
  let server: TestServer | undefined;

  beforeEach(async () => {
    ingest = await startIngest();
  });

  afterEach(async () => {
    await resetAnalytics();
    await server?.close();
    await ingest.close();
  });

  it("records per-request servers instrumented inside the handler", async () => {
    const options: AnalyticsOptions = { apiKey: KEY, endpoint: ingest.url };
    let calls = 0;
    const app = new Skybridge({
      name: "fixture-skybridge",
      version: "1.0.0",
      handler: (mcp) => {
        calls += 1;
        instrument(mcp, options);
        return registerSkybridgeTools(mcp);
      },
    });
    server = await serve(app);
    await exercise(server.url, "skybridge-client");
    await flush();

    const events = ingest.events();
    expectScenarioEvents(events, { unknownTool: "error" });
    expect(only(events, (e) => e.method === "initialize").client?.name).toBe(
      "skybridge-client"
    );
    expect(calls).toBeGreaterThan(7);
    expect(ingest.batches.every((b) => b.sdk.framework === "skybridge")).toBe(
      true
    );
    expect(ingest.batches[0]?.server).toEqual({
      name: "fixture-skybridge",
      version: "1.0.0",
    });
  });

  it("records once when both the app and each server are instrumented", async () => {
    const options: AnalyticsOptions = { apiKey: KEY, endpoint: ingest.url };
    const app = new Skybridge({
      name: "fixture-skybridge-app",
      version: "2.0.0",
      handler: (mcp) => registerSkybridgeTools(instrument(mcp, options)),
    });
    instrument(app, options);
    server = await serve(app);
    await exercise(server.url, "skybridge-app-client");
    await flush();

    expectScenarioEvents(ingest.events(), { unknownTool: "error" });
  });

  it("records a cancelled call once, without an outcome, from 2026-07-28 and legacy clients", async () => {
    const app = new Skybridge({
      name: "fixture-skybridge",
      version: "1.0.0",
      handler: (mcp) =>
        registerSkybridgeTools(
          instrument(mcp, { apiKey: KEY, endpoint: ingest.url })
        ),
    });
    server = await serve(app);

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

  it("records an app instrumented once outside the handler", async () => {
    const app = new Skybridge({
      name: "fixture-skybridge-app",
      version: "2.0.0",
      handler: (mcp) => registerSkybridgeTools(mcp),
    });
    instrument(app, { apiKey: KEY, endpoint: ingest.url });
    server = await serve(app);
    await exercise(server.url, "skybridge-app-client");
    await flush();

    const events = ingest.events();
    expectScenarioEvents(events, { unknownTool: "error" });
    expect(ingest.batches[0]?.server).toEqual({
      name: "fixture-skybridge-app",
      version: "2.0.0",
    });
  });
});
