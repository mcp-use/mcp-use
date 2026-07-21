import { describe, expect, it } from "vitest";
import type { McpServer } from "@mcp-use/client/react";
import {
  MODERN_MCP_PROTOCOL_VERSION,
  isAliasOnlyConnectionUpdate,
  protocolModeFromNegotiation,
  protocolNegotiationForMode,
  toEditableConnectionConfig,
  toMcpServerConfig,
  type EditableConnectionConfig,
} from "../connectionUpdates";

function editable(
  overrides: Partial<EditableConnectionConfig> = {}
): EditableConnectionConfig {
  return {
    url: "https://example.com/mcp",
    name: "Example",
    transportType: "http",
    connectionMode: "direct",
    protocolNegotiation: "auto",
    ...overrides,
  };
}

describe("inspector protocol negotiation", () => {
  it("maps inspector modes to official SDK negotiation values", () => {
    expect(protocolNegotiationForMode("auto")).toBe("auto");
    expect(protocolNegotiationForMode("v1")).toBe("legacy");
    expect(protocolNegotiationForMode("v2")).toEqual({
      pin: MODERN_MCP_PROTOCOL_VERSION,
    });
  });

  it("defaults missing settings to auto and recognizes persisted modes", () => {
    expect(protocolModeFromNegotiation()).toBe("auto");
    expect(protocolModeFromNegotiation("auto")).toBe("auto");
    expect(protocolModeFromNegotiation("legacy")).toBe("v1");
    expect(
      protocolModeFromNegotiation({ pin: MODERN_MCP_PROTOCOL_VERSION })
    ).toBe("v2");
  });

  it("preserves force-v2 through editable and provider configurations", () => {
    const protocolNegotiation = protocolNegotiationForMode("v2");
    const providerConfig = toMcpServerConfig(editable({ protocolNegotiation }));

    expect(providerConfig.protocolNegotiation).toEqual(protocolNegotiation);

    const server = {
      ...providerConfig,
      id: providerConfig.url,
      displayName: "Example",
    } as McpServer;
    expect(toEditableConnectionConfig(server).protocolNegotiation).toEqual(
      protocolNegotiation
    );
  });

  it("uses auto for legacy saved connections without a protocol field", () => {
    const providerConfig = toMcpServerConfig(
      editable({ protocolNegotiation: undefined })
    );
    expect(providerConfig.protocolNegotiation).toBe("auto");
  });

  it("does not classify a protocol change as an alias-only update", () => {
    const current = editable({ name: "Old name" });
    const renamed = editable({ name: "New name" });
    const forcedLegacy = editable({
      name: "New name",
      protocolNegotiation: "legacy",
    });

    expect(isAliasOnlyConnectionUpdate(current, renamed)).toBe(true);
    expect(isAliasOnlyConnectionUpdate(current, forcedLegacy)).toBe(false);
  });
});

describe("inspector connection modes", () => {
  const proxyAddress = "https://inspector.example.com/api/proxy";

  it("clears proxy and fallback state in direct mode", () => {
    const providerConfig = toMcpServerConfig(
      editable({
        connectionMode: "direct",
        proxyConfig: { proxyAddress },
        autoProxyFallback: { enabled: true, proxyAddress },
      })
    );

    expect(providerConfig).toMatchObject({
      connectionMode: "direct",
      autoProxyFallback: false,
    });
    expect(providerConfig.proxyConfig).toBeUndefined();
  });

  it("keeps the proxy inactive and available only as fallback in auto mode", () => {
    const providerConfig = toMcpServerConfig(
      editable({
        connectionMode: "auto",
        autoProxyFallback: { enabled: true, proxyAddress },
      })
    );

    expect(providerConfig.proxyConfig).toBeUndefined();
    expect(providerConfig.autoProxyFallback).toEqual({
      enabled: true,
      proxyAddress,
    });
  });

  it("uses only the immediate proxy configuration in proxy mode", () => {
    const providerConfig = toMcpServerConfig(
      editable({
        connectionMode: "proxy",
        proxyConfig: { proxyAddress },
        autoProxyFallback: { enabled: true, proxyAddress },
      })
    );

    expect(providerConfig.proxyConfig).toEqual({ proxyAddress });
    expect(providerConfig.autoProxyFallback).toBe(false);
  });
});
