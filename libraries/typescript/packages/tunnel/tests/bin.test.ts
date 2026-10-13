import { describe, expect, it, vi } from "vitest";

import { parseArgs, runTunnelCli, usage } from "../src/cli.js";

const tunnelMocks = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../src/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/index.js")>();
  return {
    ...actual,
    createTunnelManager: (...args: unknown[]) => {
      tunnelMocks.create(...args);
      return {
        start: tunnelMocks.start,
        stop: tunnelMocks.stop,
        status: () => ({ url: null }),
      };
    },
  };
});

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

  it("defaults localHostHeader to localhost in runTunnelCli", async () => {
    tunnelMocks.create.mockClear();
    tunnelMocks.start.mockResolvedValueOnce({
      url: "https://demo.tunnel.mcp-use.run",
      subdomain: "demo",
    });
    tunnelMocks.stop.mockResolvedValueOnce(undefined);

    const promise = runTunnelCli(["3000"]);
    await vi.waitFor(() =>
      expect(tunnelMocks.start).toHaveBeenCalledWith(3000)
    );
    process.emit("SIGINT");
    await promise;

    expect(tunnelMocks.create).toHaveBeenCalledWith(
      expect.stringContaining("tunnel.json"),
      { localHostHeader: "localhost" }
    );
  });
});
