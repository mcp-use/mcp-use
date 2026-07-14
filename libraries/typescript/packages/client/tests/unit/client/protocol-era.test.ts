import { describe, it, expect } from "vitest";
import { BaseConnector } from "../../../src/connectors/base.js";
import { MCPSession } from "../../../src/session.js";

/**
 * The v2 SDK negotiates a protocol era per connection (`"legacy"` for 2025-era
 * / v1 servers, `"modern"` for 2026-07-28 / v2 servers). The connector and
 * session expose it from the underlying `Client` so consumers (inspector,
 * dashboard) can display which protocol a server speaks.
 */
describe("protocol era exposure", () => {
  function connectorWithClient(era?: "legacy" | "modern", version?: string) {
    const connector = new BaseConnector();
    (connector as any).client = {
      getProtocolEra: () => era,
      getNegotiatedProtocolVersion: () => version,
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
});
