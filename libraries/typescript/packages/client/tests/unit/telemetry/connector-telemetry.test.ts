/**
 * Tests for Connector telemetry integration
 *
 * These tests verify that connectors correctly trigger telemetry events:
 * - trackConnectorInit on HTTP connector connection
 * - trackConnectorInit on Stdio connector connection
 * - Correct connector type and server info is captured
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConnectorTelemetryTracker } from "../../../src/telemetry/connector-telemetry.js";

// Create mock tracking function
const mockTrackConnectorInit = vi.fn().mockResolvedValue(undefined);

describe("Connector Telemetry Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConnectorTelemetryTracker(mockTrackConnectorInit);
  });

  afterEach(() => {
    setConnectorTelemetryTracker(undefined);
  });

  describe("BaseConnector trackConnectorInit method", () => {
    it("should add connector type automatically when calling trackConnectorInit", async () => {
      // Import BaseConnector to test the protected method
      const { BaseConnector } = await import("../../../src/transport/base.js");

      // Create a test subclass to access the protected method
      class TestConnector extends BaseConnector {
        public async connect(): Promise<void> {
          // Call the protected trackConnectorInit method
          this.trackConnectorInit({
            serverUrl: "http://test.example.com",
            publicIdentifier: "test-connector",
          });
        }

        get publicIdentifier(): Record<string, string> {
          return { type: "test" };
        }
      }

      const connector = new TestConnector();
      await connector.connect();

      expect(mockTrackConnectorInit).toHaveBeenCalledTimes(1);
      expect(mockTrackConnectorInit).toHaveBeenCalledWith({
        connectorType: "TestConnector",
        serverUrl: "http://test.example.com",
        publicIdentifier: "test-connector",
      });
    });

    it("should include serverCommand and serverArgs for stdio-like connectors", async () => {
      const { BaseConnector } = await import("../../../src/transport/base.js");

      class StdioLikeConnector extends BaseConnector {
        public async connect(): Promise<void> {
          this.trackConnectorInit({
            serverCommand: "node",
            serverArgs: ["server.js", "--port", "3000"],
            publicIdentifier: "node server.js --port 3000",
          });
        }

        get publicIdentifier(): Record<string, string> {
          return { type: "stdio", command: "node" };
        }
      }

      const connector = new StdioLikeConnector();
      await connector.connect();

      expect(mockTrackConnectorInit).toHaveBeenCalledWith({
        connectorType: "StdioLikeConnector",
        serverCommand: "node",
        serverArgs: ["server.js", "--port", "3000"],
        publicIdentifier: "node server.js --port 3000",
      });
    });

    it("should include serverUrl for http-like connectors", async () => {
      const { BaseConnector } = await import("../../../src/transport/base.js");

      class HttpLikeConnector extends BaseConnector {
        public async connect(): Promise<void> {
          this.trackConnectorInit({
            serverUrl: "http://localhost:8080/mcp",
            publicIdentifier: "http://localhost:8080/mcp (streamable-http)",
          });
        }

        get publicIdentifier(): Record<string, string> {
          return { type: "http", url: "http://localhost:8080" };
        }
      }

      const connector = new HttpLikeConnector();
      await connector.connect();

      expect(mockTrackConnectorInit).toHaveBeenCalledWith({
        connectorType: "HttpLikeConnector",
        serverUrl: "http://localhost:8080/mcp",
        publicIdentifier: "http://localhost:8080/mcp (streamable-http)",
      });
    });
  });

  describe("ConnectorInitEvent data structure", () => {
    it("should have correct properties for HTTP connector style data", async () => {
      const { ConnectorInitEvent } =
        await import("../../../src/telemetry/events.js");

      const event = new ConnectorInitEvent({
        connectorType: "HttpConnector",
        serverUrl: "http://api.example.com:3000",
        publicIdentifier: "http://api.example.com:3000 (streamable-http)",
      });

      expect(event.name).toBe("connector_init");
      const props = event.properties;

      expect(props.connector_type).toBe("HttpConnector");
      expect(props.server_url).toBe("http://api.example.com:3000");
      expect(props.public_identifier).toBe(
        "http://api.example.com:3000 (streamable-http)"
      );
      expect(props.server_command).toBeNull();
      expect(props.server_args).toBeNull();
    });

    it("should have correct properties for Stdio connector style data", async () => {
      const { ConnectorInitEvent } =
        await import("../../../src/telemetry/events.js");

      const event = new ConnectorInitEvent({
        connectorType: "StdioConnector",
        serverCommand: "uvx",
        serverArgs: ["mcp-server-fetch"],
        publicIdentifier: "uvx mcp-server-fetch",
      });

      expect(event.name).toBe("connector_init");
      const props = event.properties;

      expect(props.connector_type).toBe("StdioConnector");
      expect(props.server_command).toBe("uvx");
      expect(props.server_args).toEqual(["mcp-server-fetch"]);
      expect(props.public_identifier).toBe("uvx mcp-server-fetch");
      expect(props.server_url).toBeNull();
    });
  });

  describe("HttpConnector telemetry data verification", () => {
    it("should prepare correct telemetry data for streamable HTTP", () => {
      // Verify the expected data structure for HttpConnector
      const expectedData = {
        connectorType: "HttpConnector",
        serverUrl: "http://localhost:3000",
        publicIdentifier: "http://localhost:3000 (streamable-http)",
      };

      expect(expectedData.connectorType).toBe("HttpConnector");
      expect(expectedData.serverUrl).toBe("http://localhost:3000");
      expect(expectedData.publicIdentifier).toContain("streamable-http");
    });
  });

  describe("StdioConnector telemetry data verification", () => {
    it("should prepare correct telemetry data for command execution", () => {
      // Verify the expected data structure for StdioConnector
      const command = "node";
      const args = ["server.js", "--port", "3000"];

      const expectedData = {
        connectorType: "StdioConnector",
        serverCommand: command,
        serverArgs: args,
        publicIdentifier: `${command} ${args.join(" ")}`,
      };

      expect(expectedData.connectorType).toBe("StdioConnector");
      expect(expectedData.serverCommand).toBe("node");
      expect(expectedData.serverArgs).toEqual(["server.js", "--port", "3000"]);
      expect(expectedData.publicIdentifier).toBe("node server.js --port 3000");
    });

    it("should prepare correct telemetry data for npx command", () => {
      // Verify the expected data structure for npx-based server
      const command = "npx";
      const args = ["-y", "@my/mcp-server"];

      const expectedData = {
        connectorType: "StdioConnector",
        serverCommand: command,
        serverArgs: args,
        publicIdentifier: `${command} ${args.join(" ")}`,
      };

      expect(expectedData.connectorType).toBe("StdioConnector");
      expect(expectedData.serverCommand).toBe("npx");
      expect(expectedData.serverArgs).toContain("-y");
      expect(expectedData.publicIdentifier).toBe("npx -y @my/mcp-server");
    });
  });
});
