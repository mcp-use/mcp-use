import { readFileSync } from "node:fs";
import type { BaseConnector, ConnectorInitOptions } from "./connectors/base.js";
import type { ClientInfo } from "./connectors/http.js";
import { HttpConnector } from "./connectors/http.js";
import { StdioConnector } from "./connectors/stdio.js";
import { getPackageVersion } from "./version.js";

/**
 * Base server configuration with common optional fields
 */
interface BaseServerConfig {
  clientInfo?: ClientInfo;
}

/**
 * Server configuration for STDIO connectors
 */
export interface StdioServerConfig extends BaseServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Server configuration for HTTP connectors
 */
export interface HttpServerConfig extends BaseServerConfig {
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  authToken?: string;
  /** @deprecated Use `authToken` instead. */
  auth_token?: string;
  authProvider?: unknown;
  transport?: "http" | "sse";
  preferSse?: boolean;
  disableSseFallback?: boolean;
}

/**
 * Discriminated union of all supported server configuration types
 */
export type ServerConfig = StdioServerConfig | HttpServerConfig;

/**
 * Default clientInfo for mcp-use
 */
function getDefaultClientInfo(): ClientInfo {
  return {
    name: "mcp-use",
    title: "mcp-use",
    version: getPackageVersion(),
    description:
      "mcp-use is a complete TypeScript framework for building and using MCP",
    icons: [
      {
        src: "https://mcp-use.com/logo.png",
      },
    ],
    websiteUrl: "https://mcp-use.com",
  };
}

/**
 * Normalizes and validates clientInfo from config.
 * Ensures required fields (name, version) are present and merges with defaults.
 */
function normalizeClientInfo(input: unknown): ClientInfo {
  const fallback = getDefaultClientInfo();
  if (!input || typeof input !== "object") return fallback;
  const ci = input as Partial<ClientInfo>;
  // Require name + version (SDK/client contract)
  if (!ci.name || !ci.version) return fallback;
  return { ...fallback, ...ci };
}

export function loadConfigFile(filepath: string): Record<string, any> {
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

export function createConnectorFromConfig(
  serverConfig: ServerConfig,
  connectorOptions?: Partial<ConnectorInitOptions>
): BaseConnector {
  // Normalize clientInfo to ensure required fields are present
  const clientInfo = normalizeClientInfo(serverConfig.clientInfo);

  if ("command" in serverConfig && "args" in serverConfig) {
    return new StdioConnector({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
      clientInfo,
      ...connectorOptions,
    });
  }

  if ("url" in serverConfig) {
    // HttpConnector automatically handles streamable HTTP with SSE fallback
    const transport = serverConfig.transport || "http";

    return new HttpConnector(serverConfig.url, {
      headers: serverConfig.headers,
      fetch: serverConfig.fetch,
      authToken: serverConfig.auth_token || serverConfig.authToken,
      authProvider: serverConfig.authProvider,
      // Only force SSE if explicitly requested
      preferSse: serverConfig.preferSse || transport === "sse",
      // Disable SSE fallback if explicitly disabled in config
      disableSseFallback: serverConfig.disableSseFallback,
      clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
