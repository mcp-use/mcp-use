/**
 * Session Manager
 *
 * Simplified session management for tracking active sessions.
 * The native SDK transport handles session lifecycle internally.
 */

import type { Context } from "hono";

/**
 * Session data stored for each active MCP session
 * Following official SDK pattern - each session has its own transport and server
 */
export interface SessionData {
  /** Reference to this session's transport instance */
  transport: any;
  /** Reference to this session's server instance */
  server?: any;
  /** Timestamp of last activity for idle timeout tracking */
  lastAccessedAt: number;
  /** Hono context for this session's current request */
  context?: Context;
  /** Progress token for current tool call (if any) */
  progressToken?: number;
  /** Function to send notifications to the client */
  sendNotification?: (notification: {
    method: string;
    params: Record<string, any>;
  }) => Promise<void>;
  /** Express-like response object for notifications */
  expressRes?: any;
  /** Hono context for direct response access */
  honoContext?: Context;
  /** Minimum log level for filtering log messages (RFC 5424 levels) */
  logLevel?: string;
}

/**
 * Start idle session cleanup interval
 *
 * Monitors sessions and removes them if they've been inactive for too long.
 * Note: This only cleans up our session metadata. The transport manages
 * its own session state.
 *
 * @param sessions - Map of active sessions
 * @param idleTimeoutMs - Idle timeout in milliseconds
 * @param mcpServerInstance - Optional MCP server instance for cleanup callbacks
 */
export function startIdleCleanup(
  sessions: Map<string, SessionData>,
  idleTimeoutMs: number,
  mcpServerInstance?: any
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
        sessions.delete(sessionId);
        // Clean up resource subscriptions for this session if mcpServerInstance provided
        mcpServerInstance?.cleanupSessionSubscriptions?.(sessionId);
      }
    }
  }, 60000); // Check every minute
}
