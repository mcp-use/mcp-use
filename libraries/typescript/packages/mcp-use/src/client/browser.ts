import type { BaseConnector } from "../connectors/base.js";
import { HttpConnector } from "../connectors/http.js";
import { WebSocketConnector } from "../connectors/websocket.js";
import { BaseMCPClient } from "./base.js";

/**
 * Browser-compatible MCPClient implementation
 *
 * This client works in both browser and Node.js environments by avoiding
 * Node.js-specific APIs (like fs, path). It supports:
 * - Multiple servers via addServer()
 * - HTTP and WebSocket connectors
 * - All base client functionality
 */
export class BrowserMCPClient extends BaseMCPClient {
  constructor(config?: Record<string, any>) {
    super(config);
  }

  public static fromDict(cfg: Record<string, any>): BrowserMCPClient {
    return new BrowserMCPClient(cfg);
  }

  /**
   * Create a connector from server configuration (Browser version)
   * Supports HTTP and WebSocket connectors only
   */
  protected createConnectorFromConfig(
    serverConfig: Record<string, any>
  ): BaseConnector {
    const { url, transport, headers, authToken, authProvider, wrapTransport, clientOptions, samplingCallback } =
      serverConfig;

    if (!url) {
      throw new Error("Server URL is required");
    }

    // Prepare connector options
    const connectorOptions = {
      headers,
      authToken,
      authProvider, // ← Pass OAuth provider to connector
      wrapTransport, // ← Pass transport wrapper if provided
      clientOptions, // ← Pass client options (capabilities, etc.) to connector
      samplingCallback, // ← Pass sampling callback to connector
    };
    
    // Debug: Log if clientOptions are being passed
    if (clientOptions) {
      console.log("[BrowserMCPClient] Passing clientOptions to connector:", JSON.stringify(clientOptions, null, 2));
    } else {
      console.warn("[BrowserMCPClient] No clientOptions provided to connector!");
    }

    // Determine transport type
    if (
      transport === "websocket" ||
      url.startsWith("ws://") ||
      url.startsWith("wss://")
    ) {
      return new WebSocketConnector(url, connectorOptions);
    } else if (
      transport === "http" ||
      url.startsWith("http://") ||
      url.startsWith("https://")
    ) {
      return new HttpConnector(url, connectorOptions);
    } else {
      // Default to HTTP for browser
      return new HttpConnector(url, connectorOptions);
    }
  }
}
