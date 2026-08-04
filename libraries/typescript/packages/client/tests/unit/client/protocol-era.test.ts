import { describe, it, expect } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";
import { HttpConnector } from "../../../src/transport/http.js";
import { MCPSession } from "../../../src/core/session.js";

/**
 * The SDK negotiates a protocol era per connection (`"legacy"` for 2025-era
 * servers, `"modern"` for 2026-07-28 servers). The connector and session expose
 * it from the underlying `Client` so consumers (inspector, dashboard) can
 * display which protocol a server speaks.
 */
describe("protocol era exposure", () => {
  function connectorWithClient(
    era?: "legacy" | "modern",
    version?: string,
    server?: { name: string; version?: string; title?: string }
  ) {
    const connector = new BaseConnector();
    (connector as any).client = {
      getProtocolEra: () => era,
      getNegotiatedProtocolVersion: () => version,
      getServerVersion: () => server,
      getServerCapabilities: () => ({
        tools: {},
        extensions: { "com.example/feature": { enabled: true } },
      }),
      getInstructions: () => "Use the server carefully.",
    };
    (connector as any).serverInfoCache = server ?? null;
    (connector as any).capabilitiesCache = {
      tools: {},
      extensions: { "com.example/feature": { enabled: true } },
    };
    return connector;
  }

  it("returns undefined before a client has connected", () => {
    const connector = new BaseConnector();
    expect(connector.protocolEra).toBeUndefined();
    expect(connector.negotiatedProtocolVersion).toBeUndefined();
  });

  it("exposes the negotiated era and version from the SDK client", () => {
    const connector = connectorWithClient("modern", "2026-07-28");
    expect(connector.protocolEra).toBe("modern");
    expect(connector.negotiatedProtocolVersion).toBe("2026-07-28");
  });

  it("reports legacy for a 2025-era connection", () => {
    const connector = connectorWithClient("legacy", "2025-06-18");
    expect(connector.protocolEra).toBe("legacy");
    expect(connector.negotiatedProtocolVersion).toBe("2025-06-18");
  });

  it("MCPSession delegates protocol era/version to its connector", () => {
    const connector = connectorWithClient("modern", "2026-07-28");
    const session = new MCPSession(connector);
    expect(session.protocolEra).toBe("modern");
    expect(session.negotiatedProtocolVersion).toBe("2026-07-28");
  });

  it("normalizes negotiated server metadata for both protocol eras", () => {
    const connector = connectorWithClient("modern", "2026-07-28", {
      name: "example",
      version: "2.0.0",
      title: "Example server",
    });
    const session = new MCPSession(connector);

    expect(session.info).toEqual({
      protocolEra: "modern",
      protocolVersion: "2026-07-28",
      server: { name: "example", version: "2.0.0", title: "Example server" },
      capabilities: {
        tools: {},
        extensions: { "com.example/feature": { enabled: true } },
      },
      instructions: "Use the server carefully.",
      extensions: { "com.example/feature": { enabled: true } },
    });
    expect(session.supports("tools")).toBe(true);
    expect(session.supports("resources")).toBe(false);
  });

  it.each([
    {
      description: "a top-level serverInfo field",
      discover: (serverInfo: object) => ({ serverInfo }),
    },
    {
      description: "result metadata",
      discover: (serverInfo: object) => ({
        _meta: { "io.modelcontextprotocol/serverInfo": serverInfo },
      }),
    },
  ])(
    "uses $description when a modern client has no server version",
    async ({ discover }) => {
      const serverInfo = {
        name: "conformance",
        version: "2.0.0",
        description: "Modern conformance server",
      };
      const connector = new BaseConnector();
      (connector as any).client = {
        getProtocolEra: () => "modern",
        getNegotiatedProtocolVersion: () => "2026-07-28",
        getServerCapabilities: () => ({ tools: {} }),
        getServerVersion: () => undefined,
        getDiscoverResult: () => discover(serverInfo),
        getInstructions: () => undefined,
        listTools: async () => ({ tools: [] }),
      };

      await connector.initialize();

      expect(new MCPSession(connector).info).toMatchObject({
        protocolEra: "modern",
        protocolVersion: "2026-07-28",
        server: serverInfo,
      });
    }
  );

  it("automatically negotiates the newest supported HTTP protocol", () => {
    const connector = new HttpConnector("https://example.com/mcp");
    expect((connector as any).protocolNegotiation).toBe("auto");
  });
});
