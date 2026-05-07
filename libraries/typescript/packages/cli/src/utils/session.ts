import type { MCPSession } from "mcp-use/client";
import { MCPClient } from "mcp-use/client";
import type { NodeOAuthClientProvider } from "mcp-use/auth/node";
import { getPackageVersion } from "mcp-use/server";
import { formatError, formatInfo } from "./format.js";
import {
  buildOAuthProvider,
  isUnauthorized,
  promptYesNo,
  runOAuthFlow,
} from "./oauth.js";
import { getActiveSession, getSession } from "./session-storage.js";

export const activeSessions = new Map<
  string,
  { client: MCPClient; session: MCPSession }
>();

/**
 * Default clientInfo for mcp-use CLI.
 */
export function getCliClientInfo() {
  return {
    name: "mcp-use CLI",
    title: "mcp-use CLI",
    version: getPackageVersion(),
    description: "mcp-use CLI - Command-line interface for MCP servers",
    icons: [
      {
        src: "https://manufact.com/logo.png",
      },
    ],
    websiteUrl: "https://manufact.com",
  };
}

/**
 * Close every in-memory session and exit with `code`.
 *
 * Each `client` subcommand opens a fresh transport per process invocation,
 * which keeps an HTTP/SSE socket alive after the command returns. Without
 * this, the Node event loop never goes idle and headless agents hang.
 */
export async function cleanupAndExit(code: number): Promise<never> {
  for (const [name, { client }] of activeSessions) {
    try {
      await client.closeAllSessions();
    } catch {
      // best-effort: we're exiting anyway
    }
    activeSessions.delete(name);
  }
  process.exit(code);
}

/**
 * Get or restore a session by name. For OAuth-mode sessions whose tokens
 * have expired and can't be refreshed, prompts to re-auth on TTY or prints
 * a clear `connect` command to re-run on non-TTY.
 */
export async function getOrRestoreSession(
  sessionName: string | null
): Promise<{ name: string; session: MCPSession } | null> {
  if (!sessionName) {
    const active = await getActiveSession();
    if (!active) {
      console.error(
        formatError("No active session. Connect to a server first.")
      );
      console.error(
        formatInfo("Use: npx mcp-use client connect <url> --name <name>")
      );
      return null;
    }
    sessionName = active.name;
  }

  if (activeSessions.has(sessionName)) {
    const { session } = activeSessions.get(sessionName)!;
    return { name: sessionName, session };
  }

  const config = await getSession(sessionName);
  if (!config) {
    console.error(formatError(`Session '${sessionName}' not found`));
    return null;
  }

  try {
    const client = new MCPClient();
    const cliClientInfo = getCliClientInfo();
    let authProvider: NodeOAuthClientProvider | undefined;

    if (config.type === "http") {
      if (config.authMode === "oauth") {
        authProvider = await buildOAuthProvider(config.url!);
        client.addServer(sessionName, {
          url: config.url!,
          authProvider,
          clientInfo: cliClientInfo,
        });
      } else {
        client.addServer(sessionName, {
          url: config.url!,
          headers: config.authToken
            ? { Authorization: `Bearer ${config.authToken}` }
            : undefined,
          clientInfo: cliClientInfo,
        });
      }
    } else if (config.type === "stdio") {
      client.addServer(sessionName, {
        command: config.command!,
        args: config.args || [],
        env: config.env,
        clientInfo: cliClientInfo,
      });
    } else {
      console.error(formatError(`Unknown session type: ${config.type}`));
      return null;
    }

    let session: MCPSession;
    try {
      session = await client.createSession(sessionName);
    } catch (err) {
      // OAuth-only fallback: tokens expired and refresh failed → re-auth.
      if (
        config.type === "http" &&
        config.authMode === "oauth" &&
        authProvider &&
        isUnauthorized(err)
      ) {
        const reAuth = await promptYesNo(
          `! Tokens for session '${sessionName}' expired and could not refresh. Re-authenticate now?`,
          true
        );
        if (!reAuth) {
          console.error(formatError(`Tokens expired and could not refresh.`));
          console.error(
            formatInfo(
              `Run: mcp-use client connect ${config.url} --name ${sessionName}`
            )
          );
          return null;
        }
        await runOAuthFlow(authProvider, config.url!);
        session = await client.createSession(sessionName);
      } else {
        throw err;
      }
    }

    activeSessions.set(sessionName, { client, session });
    console.error(formatInfo(`Reconnected to session '${sessionName}'`));
    return { name: sessionName, session };
  } catch (error: any) {
    console.error(formatError(`Failed to restore session: ${error.message}`));
    return null;
  }
}
