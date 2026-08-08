import { describe, expect, it } from "vitest";

import {
  detectPendingAutoConnect,
  shouldReplaceAutoConnectConnection,
} from "../useAutoConnect";

describe("detectPendingAutoConnect", () => {
  it("returns true when autoConnect param is present", () => {
    expect(
      detectPendingAutoConnect("?autoConnect=http://localhost:3000/mcp")
    ).toBe(true);
  });

  it("returns false for plain home", () => {
    expect(detectPendingAutoConnect("")).toBe(false);
  });

  it("returns false for server-only deep links", () => {
    expect(detectPendingAutoConnect("?server=http://localhost:3000/mcp")).toBe(
      false
    );
  });
});

describe("shouldReplaceAutoConnectConnection", () => {
  it("replaces a non-ready saved SSE connection when auto-connect now requires HTTP", () => {
    expect(
      shouldReplaceAutoConnectConnection(
        {
          url: "http://localhost:3002/mcp",
          state: "failed",
          transportType: "sse",
        },
        { url: "http://localhost:3002/mcp", transportType: "http" }
      )
    ).toBe(true);
  });

  it("keeps ready connections even if their transport differs", () => {
    expect(
      shouldReplaceAutoConnectConnection(
        {
          url: "http://localhost:3002/mcp",
          state: "ready",
          transportType: "sse",
        },
        { url: "http://localhost:3002/mcp", transportType: "http" }
      )
    ).toBe(false);
  });

  it("keeps connections whose transport already matches", () => {
    expect(
      shouldReplaceAutoConnectConnection(
        {
          url: "http://localhost:3002/mcp",
          state: "failed",
          transportType: "http",
        },
        { url: "http://localhost:3002/mcp", transportType: "http" }
      )
    ).toBe(false);
  });

  it("replaces a non-ready connection when the requested protocol mode changes", () => {
    expect(
      shouldReplaceAutoConnectConnection(
        {
          url: "http://localhost:3002/mcp",
          state: "failed",
          transportType: "http",
          protocolNegotiation: "auto",
        },
        {
          url: "http://localhost:3002/mcp",
          transportType: "http",
          protocolNegotiation: "legacy",
        }
      )
    ).toBe(true);
  });
});
