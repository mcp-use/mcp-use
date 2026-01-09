import { readFileSync } from "node:fs";
import type { BaseConnector, ConnectorInitOptions } from "./connectors/base.js";
import type { ClientInfo } from "./connectors/http.js";
import { HttpConnector } from "./connectors/http.js";
import { StdioConnector } from "./connectors/stdio.js";
import { getPackageVersion } from "./version.js";

export function loadConfigFile(filepath: string): Record<string, any> {
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

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

export function createConnectorFromConfig(
  serverConfig: Record<string, any>,
  connectorOptions?: Partial<ConnectorInitOptions>
): BaseConnector {
  // Use provided clientInfo or default to mcp-use clientInfo
  const clientInfo: ClientInfo =
    serverConfig.clientInfo ?? getDefaultClientInfo();

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
      authToken: serverConfig.auth_token || serverConfig.authToken,
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
