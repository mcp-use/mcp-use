import type { OAuthClientProvider } from "@modelcontextprotocol/client";
import type { AutoOAuthOptions, CallbackConfig } from "./config.js";
import { normalizeClientInfo, resolveCallbacks } from "./config.js";
import type { BaseConnector } from "../transport/base.js";
import { HttpConnector } from "../transport/http.js";
import {
  createOAuthProvider,
  type BrowserOAuthOptions,
} from "../auth/browser.js";
import { logger } from "../utils/logging.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { getPackageVersion } from "../utils/version.js";
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
function trackBrowserClientInit(config: Record<string, any>): void {
  const servers = Object.keys(config.mcpServers ?? {});
  Tel.getInstance()
    .trackMCPClientInit({
      codeMode: false,
      sandbox: false,
      allCallbacks: false,
      verify: false,
      servers,
      numServers: servers.length,
      isBrowser: true,
    })
    .catch((e: unknown) =>
      logger.debug(`Failed to track BrowserMCPClient init: ${e}`)
    );
}

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
    trackBrowserClientInit(this.config);
  }

  public static fromDict(cfg: Record<string, any>): BrowserMCPClient {
    return new BrowserMCPClient(cfg);
  }

  protected async createDefaultOAuthProvider(
    serverUrl: string,
    options: AutoOAuthOptions = {}
  ): Promise<OAuthClientProvider> {
    return createOAuthProvider(serverUrl, options as BrowserOAuthOptions);
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
      fetch: configuredFetch,
      authToken,
      authProvider,
      wrapTransport,
      clientOptions,
      protocolNegotiation,
      timeout,
      gatewayUrl,
      serverId,
      reconnectionOptions,
    } = serverConfig;

    if (!url) {
      throw new Error("Server URL is required");
    }

    // Resolve callbacks: per-server overrides global (from config root)
    const globalDefaults = this.config as CallbackConfig;
    const resolved = resolveCallbacks(
      serverConfig as CallbackConfig,
      globalDefaults
    );

    // Root clientInfo as fallback when server config omits it
    const clientInfo = normalizeClientInfo(
      serverConfig.clientInfo ?? this.config.clientInfo
    );

    // Prepare connector options
    const connectorOptions = {
      headers,
      fetch: configuredFetch ?? globalThis.fetch.bind(globalThis),
      authToken,
      authProvider,
      wrapTransport,
      clientOptions,
      onSampling: resolved.onSampling,
      onElicitation: resolved.onElicitation,
      onNotification: resolved.onNotification,
      protocolNegotiation,
      timeout,
      clientInfo,
      gatewayUrl,
      serverId,
      reconnectionOptions,
    };

    logger.debug(
      `[BrowserMCPClient] Connector options prepared (clientOptions: ${clientOptions ? "provided" : "none"})`
    );

    return new HttpConnector(url, connectorOptions);
  }
}
