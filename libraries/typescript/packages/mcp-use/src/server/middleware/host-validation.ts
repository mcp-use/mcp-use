/**
 * Host Header Validation Middleware
 *
 * DNS rebinding protection middleware for Hono-based MCP servers.
 */

import type { Context, Next } from "hono";

function createJsonRpcErrorResponse(c: Context, message: string): Response {
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
      },
      id: null,
    },
    403
  );
}

function parseHostnameFromHostHeader(hostHeader: string): string | null {
  try {
    // URL parsing strips port and handles IPv6 host notation.
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Create middleware that validates the Host header against an allow list.
 *
 * @param allowedHostnames - Hostnames allowed to access protected endpoints
 * @returns Hono middleware
 */
export function hostHeaderValidation(allowedHostnames: string[]) {
  const normalizedAllowedHostnames = allowedHostnames.map((hostname) =>
    hostname.toLowerCase()
  );

  return async (c: Context, next: Next) => {
    const hostHeader = c.req.header("Host");

    if (!hostHeader) {
      return createJsonRpcErrorResponse(c, "Missing Host header");
    }

    const hostname = parseHostnameFromHostHeader(hostHeader);
    if (!hostname) {
      return createJsonRpcErrorResponse(
        c,
        `Invalid Host header: ${hostHeader}`
      );
    }

    if (!normalizedAllowedHostnames.includes(hostname.toLowerCase())) {
      return createJsonRpcErrorResponse(c, `Invalid Host: ${hostname}`);
    }

    await next();
  };
}
