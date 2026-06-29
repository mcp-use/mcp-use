import { describe, expect, it } from "vitest";

import { shouldReplaceAutoConnectConnection } from "../useAutoConnect";

describe("shouldReplaceAutoConnectConnection", () => {
  it("replaces a non-ready connection when auto-connect config differs on legacy transport", () => {
    expect(
      shouldReplaceAutoConnectConnection(
        {
          url: "http://localhost:3002/mcp",
          state: "failed",
          transportType: "sse" as "http",
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
          transportType: "sse" as "http",
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
