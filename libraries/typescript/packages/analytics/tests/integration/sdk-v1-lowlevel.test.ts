import { PassThrough } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ReadBuffer,
  serializeMessage,
} from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

import { flush, instrument } from "../../src/index.js";
import type { AnalyticsOptions } from "../../src/types.js";
import { registerV1Fixture } from "../helpers/fixtures-v1.js";
import { listen, type TestServer } from "../helpers/http.js";
import { startIngest, type MockIngest } from "../helpers/ingest.js";
import {
  expectScenarioEvents,
  FIXTURE,
  runScenarios,
} from "../helpers/scenarios.js";
import { byMethod, only, resetAnalytics } from "../helpers/state.js";

const KEY = "mfi_test_sdk_v1_lowlevel_00000000000000000000";

function lowLevelServer(options: AnalyticsOptions): Server {
  const server = new Server(
    { name: "fixture-lowlevel", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );
  instrument(server, options);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [FIXTURE.tools.echo, FIXTURE.tools.fail, FIXTURE.tools.explode].map(
      (name) => ({
        name,
        inputSchema: { type: "object" as const },
      })
    ),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case FIXTURE.tools.echo:
        return { content: [{ type: "text", text: "echo" }] };
      case FIXTURE.tools.fail:
        return {
          isError: true,
          content: [{ type: "text", text: "bad input" }],
        };
      case FIXTURE.tools.explode:
        throw new Error("kaput");
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool ${request.params.name} not found`
        );
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
    contents: [{ uri: request.params.uri, text: "hello" }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async () => ({
    messages: [{ role: "user", content: { type: "text", text: "hi" } }],
  }));
  return server;
}

/** Client side of an in-process stdio pipe, speaking the SDK's newline-delimited framing. */
class PipeClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  readonly #buffer = new ReadBuffer();

  constructor(
    private readonly toServer: PassThrough,
    private readonly fromServer: PassThrough
  ) {}

  async start(): Promise<void> {
    this.fromServer.on("data", (chunk: Buffer) => {
      this.#buffer.append(chunk);
      for (;;) {
        const message = this.#buffer.readMessage();
        if (message === null) break;
        this.onmessage?.(message);
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.toServer.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

describe("SDK v1 low-level Server", () => {
  let ingest: MockIngest;
  let server: TestServer;

  beforeEach(async () => {
    ingest = await startIngest();
    server = await listen((req, res) => {
      void (async () => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await lowLevelServer({ apiKey: KEY, endpoint: ingest.url }).connect(
          transport
        );
        await transport.handleRequest(req, res);
      })();
    });
  });

  afterEach(async () => {
    await resetAnalytics();
    await server.close();
    await ingest.close();
  });

  it("records thrown errors and McpErrors as JSON-RPC errors", async () => {
    const client = new Client({ name: "lowlevel-client", version: "2.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`))
    );
    await runScenarios(client);
    await flush();
    await client.close();

    const events = ingest.events();
    expectScenarioEvents(events, {
      unknownTool: "error",
      explodeOutcome: "error",
    });
    const explode = only(events, (e) => e.target === FIXTURE.tools.explode);
    expect(explode.error).toEqual({ code: -32603, message: "kaput" });
    expect(only(events, (e) => e.method === "initialize").client?.name).toBe(
      "lowlevel-client"
    );
    expect(ingest.batches[0]?.server).toEqual({
      name: "fixture-lowlevel",
      version: "0.1.0",
    });
  });
});

describe("SDK v1 McpServer over stdio", () => {
  let ingest: MockIngest;

  beforeEach(async () => {
    ingest = await startIngest();
  });

  afterEach(async () => {
    await resetAnalytics();
    await ingest.close();
  });

  it("uses one process session and the connection's client identity", async () => {
    const serverIn = new PassThrough();
    const serverOut = new PassThrough();
    const server = new McpServer({ name: "fixture-stdio", version: "3.0.0" });
    instrument(server, { apiKey: KEY, endpoint: ingest.url });
    registerV1Fixture(server);
    await server.connect(new StdioServerTransport(serverIn, serverOut));

    const client = new Client({ name: "desktop-app", version: "9.9.9" });
    await client.connect(new PipeClientTransport(serverIn, serverOut));
    await runScenarios(client);
    await flush();
    await client.close();
    await server.close();

    const events = ingest.events();
    expectScenarioEvents(events, { unknownTool: "tool_error" });
    const sessions = new Set(events.map((e) => e.session_id));
    expect(sessions.size).toBe(1);
    expect([...sessions][0]).toMatch(/^stdio-/);
    for (const event of events) {
      expect(event.transport).toBe("stdio");
      expect(event.stateless).toBe(false);
      expect(event.http).toBeUndefined();
      expect(event.client).toEqual({ name: "desktop-app", version: "9.9.9" });
    }
    expect(byMethod(events, "tools/list")[0]?.protocol_version).toBe(
      only(events, (e) => e.method === "initialize").protocol_version
    );
  });
});

describe("double instrumentation", () => {
  let ingest: MockIngest;

  beforeEach(async () => {
    ingest = await startIngest();
  });

  afterEach(async () => {
    await resetAnalytics();
    await ingest.close();
  });

  it("records once through nested wrappers and repeated instrument() calls", async () => {
    const options = { apiKey: KEY, endpoint: ingest.url };
    const serverIn = new PassThrough();
    const serverOut = new PassThrough();
    const server = new McpServer({ name: "fixture-nested", version: "1.0.0" });
    instrument(server, options);
    instrument(server.server, options);
    registerV1Fixture(server);
    // A foreign wrapper re-registers our wrapped handler; the set() override
    // wraps it again, and the per-request guard keeps one recording.
    const handlers = (
      server.server as unknown as {
        _requestHandlers: Map<string, (...args: unknown[]) => unknown>;
      }
    )._requestHandlers;
    const inner = handlers.get("tools/call")!;
    handlers.set("tools/call", (...args: unknown[]) => inner(...args));
    instrument(server, options);

    await server.connect(new StdioServerTransport(serverIn, serverOut));
    const client = new Client({ name: "nested", version: "1.0.0" });
    await client.connect(new PipeClientTransport(serverIn, serverOut));
    await client.callTool({
      name: FIXTURE.tools.echo,
      arguments: { text: "once" },
    });
    await client.callTool({
      name: FIXTURE.tools.echo,
      arguments: { text: "twice" },
    });
    await flush();
    await client.close();
    await server.close();

    const calls = byMethod(ingest.events(), "tools/call");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((e) => e.request_id)).size).toBe(2);
  });
});
