/**
 * JSON-RPC Helper Utilities
 *
 * Common utilities for creating JSON-RPC notifications, requests, and error responses.
 */

/**
 * JSON-RPC notification object structure
 */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC request object structure
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC success response object structure
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
}

/**
 * JSON-RPC error response object structure
 */
export interface JsonRpcError {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: string | number | null;
}

/**
 * Create a JSON-RPC notification object
 *
 * Notifications are one-way messages that don't expect a response.
 *
 * @param method - The notification method name
 * @param params - Optional parameters to include in the notification
 * @returns JSON-RPC notification object
 *
 * @example
 * ```typescript
 * const notification = createNotification("notifications/resources/list_changed");
 * const notificationWithParams = createNotification("custom/alert", { message: "Hello" });
 * ```
 */
export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcNotification {
  return {
    jsonrpc: "2.0" as const,
    method,
    ...(params && { params }),
  };
}

/**
 * Create a JSON-RPC request object
 *
 * Requests are two-way messages that expect a response.
 *
 * @param id - Unique request identifier
 * @param method - The request method name
 * @param params - Optional parameters to include in the request
 * @returns JSON-RPC request object
 *
 * @example
 * ```typescript
 * const request = createRequest("123", "roots/list", {});
 * ```
 */
export function createRequest(
  id: string | number,
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: "2.0" as const,
    id,
    method,
    ...(params && { params }),
  };
}

/**
 * Create a JSON-RPC success response object
 *
 * @param id - Request ID
 * @param result - Result data (optional)
 * @returns JSON-RPC response object
 *
 * @example
 * ```typescript
 * const response = createResponse("123", { data: "value" });
 * const emptyResponse = createResponse("456");
 * ```
 */
export function createResponse(
  id: string | number,
  result?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0" as const,
    id,
    ...(result !== undefined && { result }),
  };
}

/**
 * Create a JSON-RPC error response object
 *
 * @param code - Error code (e.g., -32000 for application errors)
 * @param message - Human-readable error message
 * @param id - Request ID (null if error occurred before ID could be determined)
 * @param data - Optional additional error data
 * @returns JSON-RPC error response object
 *
 * @example
 * ```typescript
 * const error = createJsonRpcError(-32000, "Session not found", "123");
 * const errorNoId = createJsonRpcError(-32600, "Invalid Request", null);
 * ```
 */
export function createJsonRpcError(
  code: number,
  message: string,
  id: string | number | null = null,
  data?: unknown
): JsonRpcError {
  return {
    jsonrpc: "2.0" as const,
    error: {
      code,
      message,
      ...(data !== undefined && { data }),
    },
    id,
  };
}

/**
 * Common JSON-RPC error codes
 */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Application-specific errors (from -32000 to -32099)
  APPLICATION_ERROR: -32000,
} as const;
