import type { MCPClient } from "mcp-use";

/**
 * Helper to get a session from MCPClient
 */
export async function getMcpSession(client: MCPClient) {
  const serverNames = client.getServerNames();

  if (serverNames.length === 0) {
    throw new Error("No servers configured in the client");
  }

  const sessionName = serverNames[0];

  // Try to get existing session or create a new one
  const session = await client.createSession(sessionName, true);

  return session;
}
