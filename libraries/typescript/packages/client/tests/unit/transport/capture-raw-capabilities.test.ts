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
