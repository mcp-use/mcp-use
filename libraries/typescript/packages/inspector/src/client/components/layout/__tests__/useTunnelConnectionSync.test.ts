import { describe, expect, it } from "vitest";
import { resolveLocalTunnelRecoveryTarget } from "../useTunnelConnectionSync";

describe("resolveLocalTunnelRecoveryTarget", () => {
  const localhost = "http://localhost:3001/mcp";
  const tunnel =
    "https://mcp-wss-tunnel-do-poc-20260728.dev-6e9.workers.dev/mcp";

  it("keeps a mounted Inspector on its localhost transport", () => {
    expect(resolveLocalTunnelRecoveryTarget(localhost, localhost)).toBeNull();
  });

  it("recovers a localhost connection previously rewritten to a tunnel", () => {
    expect(resolveLocalTunnelRecoveryTarget(tunnel, localhost)).toBe(localhost);
  });

  it("does not rewrite an explicitly selected tunnel connection", () => {
    expect(resolveLocalTunnelRecoveryTarget(tunnel, null)).toBeNull();
  });

  it("does not rewrite an explicitly selected remote MCP server", () => {
    expect(
      resolveLocalTunnelRecoveryTarget("https://example.com/mcp", null)
    ).toBeNull();
  });
});
