/**
 * Session Notifications
 *
 * Utility functions for sending JSON-RPC notifications to MCP sessions.
 */

import type { SessionData } from "./session-manager.js";
import { createNotification } from "../utils/jsonrpc-helpers.js";

/**
 * Send a notification to all connected sessions
 *
 * @param sessions - Map of active sessions
 * @param method - The notification method name
 * @param params - Optional parameters to include in the notification
 */
export async function sendNotificationToAll(
  sessions: Map<string, SessionData>,
  method: string,
  params?: Record<string, unknown>
): Promise<void> {
  const notification = createNotification(method, params);

  // Send to all active sessions
  for (const [sessionId, session] of sessions.entries()) {
    try {
      await session.transport.send(notification);
    } catch (error) {
      console.warn(
        `[MCP] Failed to send notification to session ${sessionId}:`,
        error
      );
    }
  }
}

/**
 * Send a notification to a specific session
 *
 * @param sessions - Map of active sessions
 * @param sessionId - The target session ID
 * @param method - The notification method name
 * @param params - Optional parameters to include in the notification
 * @returns true if the notification was sent, false if session not found
 */
export async function sendNotificationToSession(
  sessions: Map<string, SessionData>,
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  const notification = createNotification(method, params);

  try {
    await session.transport.send(notification);
    return true;
  } catch (error) {
    console.warn(
      `[MCP] Failed to send notification to session ${sessionId}:`,
      error
    );
    return false;
  }
}
