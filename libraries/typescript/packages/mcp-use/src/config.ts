import type { BaseConnector } from "./connectors/base.js";
import type { ConnectorInitOptions } from "./connectors/base.js";
import { readFileSync } from "node:fs";
import { HttpConnector } from "./connectors/http.js";
import { StdioConnector } from "./connectors/stdio.js";
import { WebSocketConnector } from "./connectors/websocket.js";

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
      ...connectorOptions,
    });
  }

  if ("ws_url" in serverConfig) {
    return new WebSocketConnector(serverConfig.ws_url, {
      headers: serverConfig.headers,
      authToken: serverConfig.auth_token,
      ...connectorOptions,
    });
  }

  throw new Error("Cannot determine connector type from config");
}
