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

  it("parses local-host options", () => {
    expect(parseArgs(["3000", "--local-host", "127.0.0.1"])).toEqual({
      help: false,
      port: 3000,
      localHostHeader: "127.0.0.1",
    });
    expect(
      parseArgs(["3000", "--local-host-header", "example.internal"])
    ).toEqual({
      help: false,
      port: 3000,
      localHostHeader: "example.internal",
    });
  });

  it("rejects invalid ports and unsupported options", () => {
    expect(() => parseArgs(["0"])).toThrow("Invalid local port");
    expect(() => parseArgs(["3000", "--unknown", "value"])).toThrow(
      "Unknown option"
    );
    expect(() => parseArgs(["3000", "--local-host"])).toThrow(
      "--local-host requires a value"
    );
    expect(() => parseArgs(["3000", "--local-host-header"])).toThrow(
      "--local-host-header requires a value"
    );
  });

  it("documents WebSocket relay and local-host configuration", () => {
    expect(usage()).toContain("MCP_USE_WS_RELAY");
    expect(usage()).toContain("[--local-host HOST]");
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

  it("passes custom localHostHeader in runTunnelCli", async () => {
    tunnelMocks.create.mockClear();
    tunnelMocks.start.mockResolvedValueOnce({
      url: "https://demo.tunnel.mcp-use.run",
      subdomain: "demo",
    });
    tunnelMocks.stop.mockResolvedValueOnce(undefined);

    const promise = runTunnelCli(["4000", "--local-host", "custom.host"]);
    await vi.waitFor(() =>
      expect(tunnelMocks.start).toHaveBeenCalledWith(4000)
    );
    process.emit("SIGTERM");
    await promise;

    expect(tunnelMocks.create).toHaveBeenCalledWith(
      expect.stringContaining("tunnel.json"),
      { localHostHeader: "custom.host" }
    );
  });
});
