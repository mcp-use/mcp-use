/**
 * Notification utilities
 *
 * This module provides functions for managing client notifications with the MCP server.
 */

export {
  getActiveSessions,
  sendNotification,
  sendNotificationToSession,
  sendToolsListChanged,
  sendResourcesListChanged,
  sendPromptsListChanged,
} from "./notification-registration.js";
