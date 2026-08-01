import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";

export type ServerConnection =
  | { type: "url"; url: string; headers?: Record<string, string> }
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };

export type ConnectedMcp = {
  client: MCPClient;
  session: MCPSession;
  serverName: string;
};

export async function connectMcp(
  connection: ServerConnection,
  serverName = "eval-target"
): Promise<ConnectedMcp> {
  const client = new MCPClient({
    mcpServers: {
      [serverName]:
        connection.type === "url"
          ? {
              url: connection.url,
              headers: connection.headers,
            }
          : {
              command: connection.command,
              args: connection.args ?? [],
              env: connection.env,
            },
    },
  });
  await client.createAllSessions();
  const session = client.getSession(serverName);
  if (!session) {
    throw new Error(`Failed to create MCP session for ${serverName}`);
  }
  return { client, session, serverName };
}

export async function disconnectMcp(conn: ConnectedMcp): Promise<void> {
  await conn.client.closeAllSessions();
}

export function serverConfigFromSuite(
  suiteServer: { url?: string; command?: string; args?: string[]; env?: Record<string, string> } | undefined,
  overrideUrl?: string
): ServerConnection {
  if (overrideUrl) {
    return { type: "url", url: overrideUrl };
  }
  if (suiteServer?.url) {
    return { type: "url", url: suiteServer.url };
  }
  if (suiteServer?.command) {
    return {
      type: "stdio",
      command: suiteServer.command,
      args: suiteServer.args,
      env: suiteServer.env,
    };
  }
  throw new Error("suite.server.url or server.command required (or pass --server-url)");
}
