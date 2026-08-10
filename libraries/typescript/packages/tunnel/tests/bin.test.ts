import { describe, expect, it } from "vitest";

import { parseArgs, usage } from "../src/cli.js";

describe("mcp-tunnel CLI", () => {
  it("parses relay and subdomain options", () => {
    expect(
      parseArgs([
        "3000",
        "--relay",
        "https://relay.example.com",
        "--subdomain",
        "demo",
      ])
    ).toEqual({
      help: false,
      port: 3000,
      relayUrl: "https://relay.example.com",
      subdomain: "demo",
    });
  });

  it("rejects invalid ports and unsupported options", () => {
    expect(() => parseArgs(["0"])).toThrow("Invalid local port");
    expect(() => parseArgs(["3000", "--unknown", "value"])).toThrow(
      "Unknown option"
    );
  });

  it("documents WebSocket relay configuration", () => {
    expect(usage()).toContain("MCP_USE_WS_RELAY");
  });
});
