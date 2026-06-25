import { describe, expect, it } from "vitest";

import { shouldReplaceAutoConnectConnection } from "../useAutoConnect";

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
});
