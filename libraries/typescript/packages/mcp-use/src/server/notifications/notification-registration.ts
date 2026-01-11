import type { SessionData } from "../sessions/index.js";
import {
  sendNotificationToAll,
  sendNotificationToSession as sendNotificationToSessionHelper,
} from "../sessions/notifications.js";

export interface NotificationServerContext {
  sessions: Map<string, SessionData>;
}

/**
 * Get array of active session IDs
 *
 * Returns an array of all currently active session IDs. This is useful for
 * sending targeted notifications to specific clients or iterating over
 * connected clients.
 *
 * Note: This only works in stateful mode. In stateless mode (edge environments),
 * this will return an empty array.
 *
 * @returns Array of active session ID strings
 *
 * @example
 * ```typescript
 * const sessions = server.getActiveSessions();
 * console.log(`${sessions.length} clients connected`);
 *
 * // Send notification to first connected client
 * if (sessions.length > 0) {
 *   server.sendNotificationToSession(sessions[0], "custom/hello", { message: "Hi!" });
 * }
 * ```
 */
export function getActiveSessions(this: NotificationServerContext): string[] {
  return Array.from(this.sessions.keys());
}

/**
 * Send a notification to all connected clients
 *
 * Broadcasts a JSON-RPC notification to all active sessions. Notifications are
 * one-way messages that do not expect a response from the client.
 *
 * Note: This only works in stateful mode with active sessions. If no sessions
 * are connected, the notification is silently discarded (per MCP spec: "server MAY send").
 *
 * @param method - The notification method name (e.g., "custom/my-notification")
 * @param params - Optional parameters to include in the notification
 *
 * @example
 * ```typescript
 * // Send a simple notification to all clients
 * server.sendNotification("custom/server-status", {
 *   status: "ready",
 *   timestamp: new Date().toISOString()
 * });
 *
 * // Notify all clients that resources have changed
 * server.sendNotification("notifications/resources/list_changed");
 * ```
 */
export async function sendNotification(
  this: NotificationServerContext,
  method: string,
  params?: Record<string, unknown>
): Promise<void> {
  await sendNotificationToAll(this.sessions, method, params);
}

/**
 * Send a notification to a specific client session
 *
 * Sends a JSON-RPC notification to a single client identified by their session ID.
 * This allows sending customized notifications to individual clients.
 *
 * Note: This only works in stateful mode. If the session ID doesn't exist,
 * the notification is silently discarded.
 *
 * @param sessionId - The target session ID (from getActiveSessions())
 * @param method - The notification method name (e.g., "custom/my-notification")
 * @param params - Optional parameters to include in the notification
 * @returns true if the notification was sent, false if session not found
 *
 * @example
 * ```typescript
 * const sessions = server.getActiveSessions();
 *
 * // Send different messages to different clients
 * sessions.forEach((sessionId, index) => {
 *   server.sendNotificationToSession(sessionId, "custom/welcome", {
 *     message: `Hello client #${index + 1}!`,
 *     clientNumber: index + 1
 *   });
 * });
 * ```
 */
export async function sendNotificationToSession(
  this: NotificationServerContext,
  sessionId: string,
  method: string,
  params?: Record<string, unknown>
): Promise<boolean> {
  return await sendNotificationToSessionHelper(
    this.sessions,
    sessionId,
    method,
    params
  );
}

/**
 * Notify all clients that the tools list has changed
 *
 * Convenience method that sends a `notifications/tools/list_changed` notification
 * to all connected clients. Use this when dynamically adding or removing tools
 * to prompt clients to refresh their tools cache.
 *
 * Note: This only works in stateful mode with active sessions.
 *
 * @example
 * ```typescript
 * // After dynamically registering a new tool
 * server.tool({ name: 'new_tool', ... }, async () => {...});
 * await server.sendToolsListChanged();
 * ```
 */
export async function sendToolsListChanged(
  this: NotificationServerContext
): Promise<void> {
  await sendNotificationToAll(
    this.sessions,
    "notifications/tools/list_changed"
  );
}

/**
 * Notify all clients that the resources list has changed
 *
 * Convenience method that sends a `notifications/resources/list_changed` notification
 * to all connected clients. Use this when dynamically adding or removing resources
 * to prompt clients to refresh their resources cache.
 *
 * Note: This only works in stateful mode with active sessions.
 *
 * @example
 * ```typescript
 * // After dynamically registering a new resource
 * server.resource({ name: 'new_resource', uri: 'app://new' }, async () => {...});
 * await server.sendResourcesListChanged();
 * ```
 */
export async function sendResourcesListChanged(
  this: NotificationServerContext
): Promise<void> {
  await sendNotificationToAll(
    this.sessions,
    "notifications/resources/list_changed"
  );
}

/**
 * Notify all clients that the prompts list has changed
 *
 * Convenience method that sends a `notifications/prompts/list_changed` notification
 * to all connected clients. Use this when dynamically adding or removing prompts
 * to prompt clients to refresh their prompts cache.
 *
 * Note: This only works in stateful mode with active sessions.
 *
 * @example
 * ```typescript
 * // After dynamically registering a new prompt
 * server.prompt({ name: 'new_prompt', ... }, async () => {...});
 * await server.sendPromptsListChanged();
 * ```
 */
export async function sendPromptsListChanged(
  this: NotificationServerContext
): Promise<void> {
  await sendNotificationToAll(
    this.sessions,
    "notifications/prompts/list_changed"
  );
}
