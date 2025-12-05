/**
 * Roots Registration
 *
 * This module handles roots-related functionality for the MCP server.
 * Roots represent the file system or project roots that clients have access to.
 */

import { generateUUID } from "../utils/runtime.js";
import { createRequest } from "../utils/jsonrpc-helpers.js";

/**
 * Register a callback for when a client's roots change
 *
 * When a client sends a `notifications/roots/list_changed` notification,
 * the server will automatically request the updated roots list and call
 * this callback with the new roots.
 *
 * @param callback - Function called with the updated roots array
 * @returns The server instance for method chaining
 *
 * @example
 * ```typescript
 * server.onRootsChanged(async (roots) => {
 *   console.log("Client roots updated:", roots);
 *   roots.forEach(root => {
 *     console.log(`  - ${root.name || "unnamed"}: ${root.uri}`);
 *   });
 * });
 * ```
 */
export function onRootsChanged(
  this: any,
  callback: (
    roots: Array<{ uri: string; name?: string }>
  ) => void | Promise<void>
): any {
  this.onRootsChangedCallback = callback;
  return this;
}

/**
 * Request the current roots list from a specific client session
 *
 * This sends a `roots/list` request to the client and returns
 * the list of roots the client has configured.
 *
 * @param sessionId - The session ID of the client to query
 * @returns Array of roots, or null if the session doesn't exist or request fails
 *
 * @example
 * ```typescript
 * const sessions = server.getActiveSessions();
 * if (sessions.length > 0) {
 *   const roots = await server.listRoots(sessions[0]);
 *   if (roots) {
 *     console.log(`Client has ${roots.length} roots:`);
 *     roots.forEach(r => console.log(`  - ${r.uri}`));
 *   }
 * }
 * ```
 */
export async function listRoots(
  this: any,
  sessionId: string
): Promise<Array<{ uri: string; name?: string }> | null> {
  const session = (this.sessions as Map<string, any>).get(sessionId);
  if (!session) {
    return null;
  }

  try {
    // Send roots/list request to the client
    const request = createRequest(generateUUID(), "roots/list", {});

    // The transport handles the request-response flow
    const response = await session.transport.send(request);

    // The response should contain the roots array
    if (response && typeof response === "object" && "roots" in response) {
      return (response as { roots: Array<{ uri: string; name?: string }> })
        .roots;
    }

    return [];
  } catch (error) {
    console.warn(
      `[MCP] Failed to list roots from session ${sessionId}:`,
      error
    );
    return null;
  }
}
