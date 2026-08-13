import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@mcp-use/client/react";
import {
  INSPECTOR_AUTO_RECONNECT_CONFIG,
  MODERN_MCP_PROTOCOL_VERSION,
  InspectorConnectionStorageProvider,
  isAliasOnlyConnectionUpdate,
  protocolModeFromNegotiation,
  protocolNegotiationForMode,
  toEditableConnectionConfig,
  toMcpServerConfig,
  type EditableConnectionConfig,
} from "../connectionUpdates";

describe("inspector connection health", () => {
  it("keeps reconnection enabled without probing saved servers every ten seconds", () => {
    expect(INSPECTOR_AUTO_RECONNECT_CONFIG).toEqual({
      enabled: true,
      healthCheckInterval: 60_000,
      healthCheckTimeout: 180_000,
    });
  });
});

function createLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

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

describe("InspectorConnectionStorageProvider v2 recovery", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorage());
    vi.stubGlobal("window", {
      location: {
        origin: "https://inspector.example.com",
        pathname: "/inspector",
      },
      __MCP_BASE_PATH__: "",
      __MCP_PROXY_URL__: "/inspector/api/proxy",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates valid entries while removing persisted browser client secrets", () => {
    localStorage.setItem(
      "mcp-inspector-connections",
      JSON.stringify({
        "https://example.com/mcp": {
          url: "https://example.com/mcp",
          connectionType: "Direct",
          callbackUrl:
            "https://inspector.example.com/mcp/inspector/oauth/callback",
          oauthProxyUrl:
            "https://inspector.example.com/mcp/inspector/api/oauth",
          autoProxyFallback: {
            enabled: true,
            proxyAddress:
              "https://inspector.example.com/mcp/inspector/api/proxy",
          },
          headers: { Authorization: "Bearer direct-secret" },
          proxyConfig: {
            proxyAddress:
              "https://inspector.example.com/mcp/inspector/api/proxy",
            headers: { Authorization: "Bearer proxy-secret" },
            customHeaders: { "X-Secret": "custom-secret" },
          },
          oauth: {
            clientId: "public-id",
            clientSecret: "must-not-remain",
            scope: "openid",
          },
        },
        broken: null,
      })
    );

    const provider = new InspectorConnectionStorageProvider();
    const servers = provider.getServers();

    expect(Object.keys(servers)).toEqual(["https://example.com/mcp"]);
    expect(servers["https://example.com/mcp"]?.oauth).toEqual({
      clientId: "public-id",
      scope: "openid",
    });
    expect(servers["https://example.com/mcp"]?.callbackUrl).toBeUndefined();
    expect(servers["https://example.com/mcp"]?.oauthProxyUrl).toBeUndefined();
    expect(
      typeof servers["https://example.com/mcp"]?.autoProxyFallback ===
        "object" &&
        servers["https://example.com/mcp"]?.autoProxyFallback?.proxyAddress
    ).toBe("https://inspector.example.com/inspector/api/proxy");
    expect(localStorage.getItem("mcp-inspector-connections")).not.toContain(
      "must-not-remain"
    );
    expect(localStorage.getItem("mcp-inspector-connections")).not.toContain(
      "direct-secret"
    );
    expect(localStorage.getItem("mcp-inspector-connections")).not.toContain(
      "proxy-secret"
    );
    expect(localStorage.getItem("mcp-inspector-connections")).not.toContain(
      "custom-secret"
    );
    expect(localStorage.getItem("mcp-inspector-connections-version")).toBe("3");
  });

  it("drops unreadable storage without affecting future writes", () => {
    localStorage.setItem("mcp-inspector-connections", "not-json{");

    const provider = new InspectorConnectionStorageProvider();
    expect(provider.getServers()).toEqual({});

    provider.setServer("https://new.example/mcp", {
      url: "https://new.example/mcp",
    });
    expect(provider.getServers()).toMatchObject({
      "https://new.example/mcp": { url: "https://new.example/mcp" },
    });
  });

  it("recovers a localhost connection URL before its client wrapper mounts", () => {
    const localUrl = "http://localhost:3001/mcp";
    localStorage.setItem(
      "mcp-inspector-connections",
      JSON.stringify({
        [localUrl]: {
          url: "https://mcp-wss-tunnel.example.workers.dev/mcp",
          connectionMode: "auto",
        },
      })
    );

    const servers = new InspectorConnectionStorageProvider().getServers();

    expect(servers[localUrl]?.url).toBe(localUrl);
    expect(
      JSON.parse(localStorage.getItem("mcp-inspector-connections") ?? "{}")[
        localUrl
      ]?.url
    ).toBe(localUrl);
  });

  it("returns recovered connections when browser storage rejects migration writes", () => {
    const stored = JSON.stringify({
      "https://example.com/mcp": { url: "https://example.com/mcp" },
    });
    vi.stubGlobal("localStorage", {
      ...createLocalStorage(),
      getItem: (key: string) =>
        key === "mcp-inspector-connections" ? stored : null,
      setItem: () => {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });

    expect(new InspectorConnectionStorageProvider().getServers()).toEqual({
      "https://example.com/mcp": {
        url: "https://example.com/mcp",
        connectionMode: "auto",
      },
    });
  });

  it("honors a custom Inspector connection storage key", () => {
    localStorage.setItem(
      "custom-connections",
      JSON.stringify({
        "https://custom.example/mcp": {
          url: "https://custom.example/mcp",
        },
      })
    );

    const provider = new InspectorConnectionStorageProvider(
      "custom-connections"
    );
    expect(provider.getServers()).toEqual({
      "https://custom.example/mcp": {
        url: "https://custom.example/mcp",
        connectionMode: "auto",
      },
    });
    expect(localStorage.getItem("custom-connections-version")).toBe("3");
  });
});
