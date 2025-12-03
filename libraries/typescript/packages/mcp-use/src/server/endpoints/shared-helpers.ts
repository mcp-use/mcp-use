/**
 * Shared Helper Functions for MCP Endpoints
 *
 * Common utilities used by POST, GET, and DELETE handlers.
 */

import type { Context } from "hono";
import {
  createJsonRpcError,
  JsonRpcErrorCode,
} from "../utils/jsonrpc-helpers.js";

/**
 * Error response for session not found (404)
 */
export function createSessionNotFoundError(body?: any) {
  return createJsonRpcError(
    JsonRpcErrorCode.APPLICATION_ERROR,
    "Session not found or expired",
    body?.id ?? null
  );
}

/**
 * Error response for missing session ID (400)
 */
export function createBadRequestError(body?: any) {
  return createJsonRpcError(
    JsonRpcErrorCode.APPLICATION_ERROR,
    "Bad Request: Mcp-Session-Id header is required",
    body?.id ?? null
  );
}

/**
 * Validate session and return appropriate error response if invalid
 *
 * @returns null if valid, otherwise returns { error, statusCode }
 */
export function validateSession(
  sessionId: string | undefined,
  transport: any,
  body?: any
): { error: any; statusCode: 400 | 404 } | null {
  if (!transport) {
    if (sessionId) {
      // Session ID was provided but not found (expired or invalid)
      return {
        error: createSessionNotFoundError(body),
        statusCode: 404,
      };
    } else {
      // No session ID for non-init request
      return {
        error: createBadRequestError(body),
        statusCode: 400,
      };
    }
  }
  return null;
}

/**
 * Setup abort signal handling for transport
 */
export function setupAbortSignal(c: Context, transport: any): void {
  c.req.raw.signal?.addEventListener("abort", () => {
    transport.close();
  });
}
