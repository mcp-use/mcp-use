/**
 * Regression coverage for inbound v1 handler lifecycle ordering.
 *
 * Run with: pnpm test:run tests/unit/client/connector-callback-ordering.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  events: [] as string[],
  terminateSession: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock("@modelcontextprotocol/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/client")>();

  class MockClient {
    _notificationHandlers = new Map();
    fallbackNotificationHandler?: (notification: unknown) => Promise<void>;

    constructor() {
      lifecycle.events.push("client:construct");
    }

    setRequestHandler(method: string): void {
      lifecycle.events.push(`handler:${method}`);
    }

    async connect(): Promise<void> {
      lifecycle.events.push("client:connect");
    }

    async close(): Promise<void> {
      lifecycle.events.push("client:close");
    }
  }

  class MockStreamableHTTPClientTransport {
    sessionId = "test-session";

    async close(): Promise<void> {
      lifecycle.events.push("transport:close");
    }

    async terminateSession(): Promise<void> {
      lifecycle.events.push("transport:terminate");
      await lifecycle.terminateSession();
    }
  }

  return {
    ...actual,
    Client: MockClient,
    StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
  };
});

import { HttpConnector } from "../../../src/transport/http.js";

class TestHttpConnector extends HttpConnector {
  protected trackConnectorInit(): void {
    // Telemetry is outside the lifecycle behavior under test.
  }
}

describe("HttpConnector inbound handler ordering", () => {
  beforeEach(() => {
    lifecycle.events.length = 0;
    lifecycle.terminateSession.mockReset();
    lifecycle.terminateSession.mockResolvedValue(undefined);
  });

  it("registers v1 handlers once before streamable HTTP Client.connect()", async () => {
    const connector = new TestHttpConnector("http://localhost:3000/mcp", {
      onSampling: vi.fn().mockResolvedValue({
        role: "assistant",
        content: { type: "text", text: "sampled" },
        model: "test-model",
      }),
      onElicitation: vi.fn().mockResolvedValue({ action: "decline" }),
      timeout: 10,
    });

    await connector.connect();

    expect(lifecycle.events).toEqual([
      "client:construct",
      "handler:roots/list",
      "handler:sampling/createMessage",
      "handler:elicitation/create",
      "client:connect",
    ]);

    await connector.disconnect();
  });

  it("bounds legacy session termination before closing the transport", async () => {
    lifecycle.terminateSession.mockImplementation(() => new Promise(() => {}));
    const connector = new TestHttpConnector("http://localhost:3000/mcp", {
      timeout: 10,
    });

    await connector.connect();
    await connector.disconnect();

    expect(lifecycle.events.slice(-3)).toEqual([
      "transport:terminate",
      "client:close",
      "transport:close",
    ]);
  });
});
