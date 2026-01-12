import type { BaseConnector } from "../connectors/base.js";
import { HttpConnector } from "../connectors/http.js";
import { logger } from "../logging.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { getPackageVersion } from "../version.js";
import { BaseMCPClient } from "./base.js";

/**
 * Browser-compatible MCPClient implementation
 *
 * This client works in both browser and Node.js environments by avoiding
 * Node.js-specific APIs (like fs, path). It supports:
 * - Multiple servers via addServer()
 * - HTTP connector
 * - All base client functionality
 */
export class BrowserMCPClient extends BaseMCPClient {
  /**
   * Get the mcp-use package version.
   * Works in all environments (Node.js, browser, Cloudflare Workers, Deno, etc.)
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  constructor(config?: Record<string, any>) {
    super(config);
    this._trackClientInit();
  }

  private _trackClientInit(): void {
    const servers = Object.keys(this.config.mcpServers ?? {});

    Tel.getInstance()
      .trackMCPClientInit({
        codeMode: false, // Browser client doesn't support code mode
        sandbox: false, // Sandbox not supported in browser
        allCallbacks: false, // Will be set per-server
        verify: false,
        servers,
        numServers: servers.length,
        isBrowser: true, // Browser MCPClient
      })
      .catch((e) =>
        logger.debug(`Failed to track BrowserMCPClient init: ${e}`)
      );
  }

  public static fromDict(cfg: Record<string, any>): BrowserMCPClient {
    return new BrowserMCPClient(cfg);
  }

  /**
   * Create a connector from server configuration (Browser version)
   * Supports HTTP connector only
   */
  protected createConnectorFromConfig(
    serverConfig: Record<string, any>
  ): BaseConnector {
    const {
      url,
      headers,
      authToken,
      authProvider,
      wrapTransport,
      clientOptions,
      onSampling,
      samplingCallback,
      elicitationCallback,
      disableSseFallback,
      preferSse,
      clientInfo,
      gatewayUrl,
      serverId,
    } = serverConfig;

    if (!url) {
      throw new Error("Server URL is required");
    }

    // Support both new and deprecated name
    const finalOnSampling = onSampling ?? samplingCallback;

    // Prepare connector options
    const connectorOptions = {
      headers,
      authToken,
      authProvider, // ← Pass OAuth provider to connector
      wrapTransport, // ← Pass transport wrapper if provided
      clientOptions, // ← Pass client options (capabilities, etc.) to connector
      onSampling: finalOnSampling, // ← Pass sampling callback to connector (new name)
      samplingCallback: finalOnSampling, // ← Backward compatibility: also pass as old name
      elicitationCallback, // ← Pass elicitation callback to connector
      disableSseFallback, // ← Disable automatic SSE fallback
      preferSse, // ← Use SSE transport directly
      clientInfo, // ← Pass client info (name, version) to connector
      gatewayUrl, // ← Pass gateway/proxy URL to connector
      serverId, // ← Pass server ID for gateway observability
    };

    // Debug: Log if clientOptions are being passed
    if (clientOptions) {
      console.log(
        "[BrowserMCPClient] Passing clientOptions to connector:",
        JSON.stringify(clientOptions, null, 2)
      );
    } else {
      console.warn(
        "[BrowserMCPClient] No clientOptions provided to connector!"
      );
    }

    // Use HTTP connector for browser
    return new HttpConnector(url, connectorOptions);
  }
}
