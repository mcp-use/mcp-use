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
 * Manages MCP server connections in browsers and other Web API runtimes.
 *
 * The browser client supports HTTP servers and the connection-management
 * operations inherited from its runtime-neutral base client. It does not spawn local
 * processes or read configuration files.
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
   * Returns the installed `@mcp-use/client` package version.
   *
   * @returns The package version string.
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  /**
   * Creates a browser MCP client.
   *
   * @param config - Client configuration containing an optional `mcpServers` map.
   */
  constructor(config?: Record<string, any>) {
    super(config);
    trackBrowserClientInit(this.config);
  }

  /**
   * Creates a browser client from an inline configuration object.
   *
   * @param cfg - Client configuration containing an optional `mcpServers` map.
   * @returns A browser client initialized with `cfg`.
   */
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
