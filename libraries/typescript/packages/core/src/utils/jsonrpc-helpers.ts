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
 * Runtime type guard: checks if a message is a JSON-RPC response (success or error).
 * Uses duck-typing for speed — no Zod parsing overhead.
 */
export function isJsonRpcResponse(
  msg: unknown
): msg is JsonRpcResponse | JsonRpcError {
  return (
    !!msg &&
    typeof msg === "object" &&
    "id" in msg &&
    ("result" in msg || "error" in msg)
  );
}

/**
 * Runtime type guard: checks if a message is a JSON-RPC request (has id + method, not a response).
 */
export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    !!msg &&
    typeof msg === "object" &&
    "id" in msg &&
    "method" in msg &&
    !("result" in msg) &&
    !("error" in msg)
  );
}
