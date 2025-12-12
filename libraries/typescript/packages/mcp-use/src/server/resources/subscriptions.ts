/**
 * Resource Subscription Management
 *
 * Handles subscription tracking and notifications for MCP resource updates.
 * Implements the MCP resources/subscribe and resources/unsubscribe protocol.
 */

import type { McpServer as OfficialMcpServer } from "@mcp-use/modelcontextprotocol-sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@mcp-use/modelcontextprotocol-sdk/types.js";
import type { SessionData } from "../sessions/index.js";
import { getRequestContext } from "../context-storage.js";

/**
 * Subscription manager for tracking resource subscriptions across sessions
 */
export class ResourceSubscriptionManager {
  /**
   * Tracks resource subscriptions per session
   * Map structure: uri -> Set<sessionId>
   */
  private subscriptions = new Map<string, Set<string>>();

  /**
   * Register subscription handlers with an MCP server instance
   *
   * @param server - The native MCP server instance
   * @param sessions - Map of active sessions
   */
  public registerHandlers(
    server: OfficialMcpServer,
    sessions: Map<string, SessionData>
  ): void {
    // Register resources/subscribe handler per MCP specification
    server.server.setRequestHandler(
      SubscribeRequestSchema,
      async (request: { params: { uri: string } }) => {
        const { uri } = request.params;

        // Get session ID from request context
        const sessionId = this.getSessionIdFromContext(sessions, server);

        if (!sessionId) {
          console.warn(
            `[MCP] Could not determine session ID for resource subscription to ${uri}`
          );
          return {};
        }

        // Track the subscription
        if (!this.subscriptions.has(uri)) {
          this.subscriptions.set(uri, new Set());
        }
        this.subscriptions.get(uri)!.add(sessionId);

        console.log(
          `[MCP] Session ${sessionId} subscribed to resource: ${uri}`
        );

        return {}; // Empty result per MCP spec
      }
    );

    // Register resources/unsubscribe handler per MCP specification
    server.server.setRequestHandler(
      UnsubscribeRequestSchema,
      async (request: { params: { uri: string } }) => {
        const { uri } = request.params;

        // Get session ID from request context
        const sessionId = this.getSessionIdFromContext(sessions, server);

        if (!sessionId) {
          console.warn(
            `[MCP] Could not determine session ID for resource unsubscribe from ${uri}`
          );
          return {};
        }

        // Remove the subscription
        const subscribers = this.subscriptions.get(uri);
        if (subscribers) {
          subscribers.delete(sessionId);
          if (subscribers.size === 0) {
            this.subscriptions.delete(uri);
          }
          console.log(
            `[MCP] Session ${sessionId} unsubscribed from resource: ${uri}`
          );
        }

        return {}; // Empty result per MCP spec
      }
    );
  }

  /**
   * Get session ID from request context or sessions map
   *
   * @param sessions - Map of active sessions
   * @param server - The server instance to match against
   * @returns The session ID, or undefined if not found
   */
  private getSessionIdFromContext(
    sessions: Map<string, SessionData>,
    server: OfficialMcpServer
  ): string | undefined {
    const requestContext = getRequestContext();
    let sessionId: string | undefined;

    if (requestContext) {
      sessionId = requestContext.req.header("mcp-session-id");
    }

    // If we can't get sessionId from context, try to find it from sessions map
    if (!sessionId) {
      for (const [sid, session] of sessions.entries()) {
        if (session.server === server) {
          sessionId = sid;
          break;
        }
      }
    }

    return sessionId;
  }

  /**
   * Notify subscribed clients that a resource has been updated
   *
   * This method sends a `notifications/resources/updated` notification to all
   * sessions that have subscribed to the specified resource URI.
   *
   * @param uri - The URI of the resource that changed
   * @param sessions - Map of active sessions
   * @returns Promise that resolves when all notifications have been sent
   */
  public async notifyResourceUpdated(
    uri: string,
    sessions: Map<string, SessionData>
  ): Promise<void> {
    const subscribers = this.subscriptions.get(uri);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    console.log(
      `[MCP] Notifying ${subscribers.size} subscriber(s) of resource update: ${uri}`
    );

    // Send notification to all subscribed sessions
    for (const sessionId of subscribers) {
      const session = sessions.get(sessionId);
      if (session?.server) {
        try {
          await session.server.server.sendResourceUpdated({ uri });
          console.log(
            `[MCP] Sent resource update notification to session ${sessionId}`
          );
        } catch (error) {
          console.error(
            `[MCP] Failed to send resource update notification to session ${sessionId}:`,
            error
          );
        }
      }
    }
  }

  /**
   * Clean up resource subscriptions for a closed session
   *
   * This method is called automatically when a session is closed to remove
   * all resource subscriptions associated with that session.
   *
   * @param sessionId - The session ID to clean up
   */
  public cleanupSession(sessionId: string): void {
    for (const [uri, subscribers] of this.subscriptions) {
      subscribers.delete(sessionId);
      if (subscribers.size === 0) {
        this.subscriptions.delete(uri);
      }
    }
    console.log(
      `[MCP] Cleaned up resource subscriptions for session ${sessionId}`
    );
  }
}
