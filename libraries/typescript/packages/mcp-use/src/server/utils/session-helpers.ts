/**
 * Session Helper Utilities
 *
 * Common utilities for working with MCP sessions.
 */

import type { SessionData } from "../sessions/session-manager.js";

/**
 * Get a session from the sessions map, or return null if not found
 *
 * This is a safe session lookup helper that ensures consistent handling
 * of missing sessions across the codebase.
 *
 * @param sessions - Map of active sessions
 * @param sessionId - The session ID to look up
 * @returns The session data if found, null otherwise
 *
 * @example
 * ```typescript
 * const session = getSessionOrNull(sessions, sessionId);
 * if (!session) {
 *   return createSessionNotFoundError();
 * }
 * // Use session safely
 * ```
 */
export function getSessionOrNull(
  sessions: Map<string, SessionData>,
  sessionId: string
): SessionData | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Check if a session exists
 *
 * @param sessions - Map of active sessions
 * @param sessionId - The session ID to check
 * @returns true if the session exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasSession(sessions, sessionId)) {
 *   console.log('Session exists');
 * }
 * ```
 */
export function hasSession(
  sessions: Map<string, SessionData>,
  sessionId: string
): boolean {
  return sessions.has(sessionId);
}

/**
 * Get all active session IDs
 *
 * @param sessions - Map of active sessions
 * @returns Array of session IDs
 *
 * @example
 * ```typescript
 * const sessionIds = getAllSessionIds(sessions);
 * console.log(`${sessionIds.length} active sessions`);
 * ```
 */
export function getAllSessionIds(sessions: Map<string, SessionData>): string[] {
  return Array.from(sessions.keys());
}
