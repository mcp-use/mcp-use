/**
 * Session Manager
 *
 * Simplified session management for tracking active sessions.
 * The native SDK transport handles session lifecycle internally.
 */

import type { Context } from "hono";
import type { Transport } from "@mcp-use/modelcontextprotocol-sdk/shared/transport.js";
import type { McpServer } from "@mcp-use/modelcontextprotocol-sdk/server/mcp.js";

/**
 * Session data stored for each active MCP session
 * Following official SDK pattern - each session has its own transport and server
 */
export interface SessionData {
  /** Reference to this session's transport instance */
  transport: Transport;
  /** Reference to this session's server instance */
  server?: McpServer;
  /** Timestamp of last activity for idle timeout tracking */
  lastAccessedAt: number;
  /** Hono context for this session's current request */
  context?: Context;
  /** Progress token for current tool call (if any) */
  progressToken?: number;
  /** Function to send notifications to the client */
  sendNotification?: (notification: {
    method: string;
    params: Record<string, unknown>;
  }) => Promise<void>;
  /** Express-like response object for notifications */
  expressRes?: Response | Record<string, unknown>;
  /** Hono context for direct response access */
  honoContext?: Context;
  /** Minimum log level for filtering log messages (RFC 5424 levels) */
  logLevel?: string;
  /** Client capabilities advertised during initialization */
  clientCapabilities?: Record<string, unknown>;
}

/**
 * Start idle session cleanup interval
 *
 * Monitors sessions and removes them if they've been inactive for too long.
 * Also cleans up the associated transports to prevent "Server not initialized" errors
 * when clients try to reconnect with expired session IDs.
 *
 * @param sessions - Map of active sessions
 * @param idleTimeoutMs - Idle timeout in milliseconds
 * @param transports - Optional map of transports by session ID (to close on cleanup)
 * @param mcpServerInstance - Optional MCP server instance for cleanup callbacks
 */
export function startIdleCleanup(
  sessions: Map<string, SessionData>,
  idleTimeoutMs: number,
  transports?: Map<string, { close?: () => Promise<void> | void }>,
  mcpServerInstance?: {
    cleanupSessionSubscriptions?: (sessionId: string) => void;
  }
): NodeJS.Timeout | undefined {
  if (idleTimeoutMs <= 0) {
    return undefined;
  }

  return setInterval(() => {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastAccessedAt > idleTimeoutMs) {
        expiredSessions.push(sessionId);
      }
    }

    if (expiredSessions.length > 0) {
      console.log(
        `[MCP] Cleaning up ${expiredSessions.length} idle session(s)`
      );
      for (const sessionId of expiredSessions) {
        // Close transport first to prevent "Server not initialized" errors on reconnect
        const transport = transports?.get(sessionId);
        if (transport?.close) {
          Promise.resolve(transport.close()).catch((e) => {
            console.warn(
              `[MCP] Error closing transport for session ${sessionId}:`,
              e
            );
          });
        }
        transports?.delete(sessionId);

        sessions.delete(sessionId);
        // Clean up resource subscriptions for this session if mcpServerInstance provided
        mcpServerInstance?.cleanupSessionSubscriptions?.(sessionId);
        console.log(
          `[MCP] Cleaned up resource subscriptions for session ${sessionId}`
        );
      }
    }
  }, 60000); // Check every minute
}
