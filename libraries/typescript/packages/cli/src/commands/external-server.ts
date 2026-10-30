import { openDirectConnection } from "./client.js";
import { CommandError } from "./shared.js";

/** Verify an external URL completes an MCP handshake before changing cloud state. */
export async function validateExternalServer(url: string): Promise<void> {
  try {
    const connection = await openDirectConnection(url, {}, true, 30_000);
    await connection.disconnect();
  } catch (error) {
    // Missing local dependencies are actionable CLI setup errors, not bad URLs.
    if (error instanceof CommandError && error.code.startsWith("client_")) {
      throw error;
    }
    throw new CommandError(
      "invalid_mcp_server",
      "The external URL did not complete an MCP handshake. " +
        "Check that it points to the server's MCP endpoint (usually /mcp).",
      { reason: error instanceof Error ? error.message : "Connection failed." }
    );
  }
}
