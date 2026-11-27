import { describe, expect, it } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";

class TestConnector extends BaseConnector {
  get publicIdentifier() {
    return { type: "test" };
  }
  async connect() {}
  capture(t: { onmessage?: (m: any) => void }) {
    this.captureRawCapabilities(t);
  }
}

describe("captureRawCapabilities", () => {
  it("keeps a wrapper's onmessage forwarding to the inner transport", () => {
    // Shape of the Inspector's wrapTransport wrappers: onmessage is an
    // accessor that stores the handler on the inner transport.
    const inner: { onmessage?: (m: any) => void } = {};
    const wrapper = {} as { onmessage?: (m: any) => void };
    Object.defineProperty(wrapper, "onmessage", {
      configurable: true,
      enumerable: true,
      get: () => inner.onmessage,
      set: (h) => {
        inner.onmessage = h;
      },
    });

    new TestConnector().capture(wrapper);
    const received: unknown[] = [];
    wrapper.onmessage = (m) => received.push(m);

    const reply = { jsonrpc: "2.0", id: "server-discover-probe-1", result: {} };
    inner.onmessage?.(reply);
    expect(received).toEqual([reply]);
  });

  it("still delivers messages on a plain transport", () => {
    const transport: { onmessage?: (m: any) => void } = {};
    new TestConnector().capture(transport);
    const received: unknown[] = [];
    transport.onmessage = (m) => received.push(m);
    transport.onmessage?.({ jsonrpc: "2.0", id: 1, result: {} });
    expect(received).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });
});

describe("initialize", () => {
  it("returns the captured capabilities, including events", async () => {
    const transport: { onmessage?: (m: any) => void } = {};
    const connector = new TestConnector();
    connector.capture(transport);
    transport.onmessage = () => {};
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 0,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {}, events: { listChanged: false } },
        serverInfo: { name: "s", version: "1" },
      },
    });
    // The SDK client parses capabilities with a schema that drops `events`.
    (connector as any).client = {
      getServerCapabilities: () => ({ tools: {} }),
      getServerVersion: () => ({ name: "s", version: "1" }),
      listTools: async () => ({ tools: [] }),
    };
    const caps = await connector.initialize();
    expect(caps).toEqual({ tools: {}, events: { listChanged: false } });
    expect(connector.serverCapabilities).toEqual({
      tools: {},
      events: { listChanged: false },
    });
  });
});
