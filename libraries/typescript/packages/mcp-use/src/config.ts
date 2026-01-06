import type { BaseConnector } from "./connectors/base.js";
import type { ConnectorInitOptions } from "./connectors/base.js";
import { readFileSync } from "node:fs";
import { HttpConnector } from "./connectors/http.js";
import { StdioConnector } from "./connectors/stdio.js";

export function loadConfigFile(filepath: string): Record<string, any> {
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

export function createConnectorFromConfig(
  serverConfig: Record<string, any>,
  connectorOptions?: Partial<ConnectorInitOptions>
): BaseConnector {
  if ("command" in serverConfig && "args" in serverConfig) {
    return new StdioConnector({
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env,
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
      // Pass clientInfo if provided in server config
      clientInfo: serverConfig.clientInfo,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
