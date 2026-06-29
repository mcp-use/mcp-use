import type { CallbackConfig } from "../config.js";
import { normalizeClientInfo, resolveCallbacks } from "../config.js";
import type {
  BaseConnector,
  ConnectorInitOptions,
} from "../connectors/base.js";
import { HttpConnector } from "../connectors/http.js";
import { logger } from "../logging.js";
import { Tel } from "../telemetry/telemetry-browser.js";
import { getPackageVersion } from "../version.js";
import {
  BaseMCPClient,
  type MCPClientConfig,
  type MCPServerConfig,
} from "./base.js";

type BrowserServerConfig = MCPServerConfig & {
  url?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  authToken?: string;
  authProvider?: ConnectorInitOptions["authProvider"];
  wrapTransport?: ConnectorInitOptions["wrapTransport"];
  clientOptions?: ConnectorInitOptions["clientOptions"];
  timeout?: number;
  sseReadTimeout?: number;
  gatewayUrl?: string;
  serverId?: string;
  reconnectionOptions?: ConnectorInitOptions["reconnectionOptions"];
  clientInfo?: unknown;
};

/**
 * Browser-compatible MCPClient implementation
 *
 * This client works in both browser and Node.js environments by avoiding
 * Node.js-specific APIs (like fs, path). It supports:
 * - Multiple servers via addServer()
 * - HTTP connector
 * - All base client functionality
 */
function trackBrowserClientInit(config: MCPClientConfig): void {
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
    .catch((e) => logger.debug(`Failed to track BrowserMCPClient init: ${e}`));
}

export class BrowserMCPClient extends BaseMCPClient {
  /**
   * Get the mcp-use package version.
   * Works in all environments (Node.js, browser, Cloudflare Workers, Deno, etc.)
   */
  public static getPackageVersion(): string {
    return getPackageVersion();
  }

  constructor(config?: MCPClientConfig) {
    super(config);
    trackBrowserClientInit(this.config);
  }

  public static fromDict(cfg: MCPClientConfig): BrowserMCPClient {
    return new BrowserMCPClient(cfg);
  }

  /**
   * Create a connector from server configuration (Browser version)
   * Supports HTTP connector only
   */
  protected createConnectorFromConfig(
    serverConfig: MCPServerConfig
  ): BaseConnector {
    const typedConfig = serverConfig as BrowserServerConfig;
    const {
      url,
      headers,
      fetch,
      authToken,
      authProvider,
      wrapTransport,
      clientOptions,
      timeout,
      sseReadTimeout,
      gatewayUrl,
      serverId,
      reconnectionOptions,
    } = typedConfig;

    if (!url) {
      throw new Error("Server URL is required");
    }

    // Resolve callbacks: per-server overrides global (from config root)
    const globalDefaults = this.config as CallbackConfig;
    const resolved = resolveCallbacks(
      typedConfig as CallbackConfig,
      globalDefaults
    );

    // Root clientInfo as fallback when server config omits it
    const clientInfo = normalizeClientInfo(
      typedConfig.clientInfo ?? this.config.clientInfo
    );

    // Prepare connector options
    const connectorOptions = {
      headers,
      fetch,
      authToken,
      authProvider,
      wrapTransport,
      clientOptions,
      onSampling: resolved.onSampling,
      onElicitation: resolved.onElicitation,
      onNotification: resolved.onNotification,
      timeout,
      sseReadTimeout,
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
