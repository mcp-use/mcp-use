import type { Context, MiddlewareHandler, Next } from "hono";

/**
 * Detects if a middleware is Express/Connect style or Hono style
 *
 * Express/Connect middleware: (req, res, next) => void or (err, req, res, next) => void
 * Hono middleware: (c, next) => Promise<Response | void> or (c, next) => Response | void
 *
 * @param middleware - The middleware function to check
 * @returns true if it's Express/Connect middleware, false if it's Hono middleware
 */
export function isExpressMiddleware(middleware: any): boolean {
  if (!middleware || typeof middleware !== "function") {
    return false;
  }

  // Check function arity (number of parameters)
  // Express/Connect middleware has 3 parameters (req, res, next) or 4 (err, req, res, next)
  // Hono middleware typically has 2 parameters (c, next)
  const paramCount = middleware.length;

  // Express/Connect middleware has 3 or 4 parameters
  if (paramCount === 3 || paramCount === 4) {
    return true;
  }

  // Hono middleware has 2 parameters
  if (paramCount === 2) {
    // Additional heuristic: check if the middleware uses Express-specific patterns
    const fnString = middleware.toString();

    // Look for Express-specific patterns in the function body
    // Common Express patterns: res.send, res.json, res.status, req.body, req.params, etc.
    const expressPatterns = [
      /\bres\.(send|json|status|end|redirect|render|sendFile|download)\b/,
      /\breq\.(body|params|query|cookies|session)\b/,
      /\breq\.get\s*\(/,
      /\bres\.set\s*\(/,
    ];

    const hasExpressPattern = expressPatterns.some((pattern) =>
      pattern.test(fnString)
    );
    if (hasExpressPattern) {
      return true;
    }

    // If it has 2 parameters and no Express patterns, assume it's Hono
    return false;
  }

  // For other parameter counts or edge cases, default to Hono
  return false;
}

/**
 * Automatically adapts middleware to work with Hono
 * Detects if the middleware is Express/Connect style and adapts it accordingly
 * If it's already Hono-compatible middleware, returns it as-is
 *
 * @param middleware - The middleware function (Express/Connect or Hono)
 * @param middlewarePath - The path pattern the middleware is mounted at (optional, only used for Express/Connect middleware)
 * @returns A Hono middleware function
 */
export async function adaptMiddleware(
  middleware: any,
  middlewarePath: string = "*"
): Promise<MiddlewareHandler> {
  // Check if it's Express/Connect middleware
  if (isExpressMiddleware(middleware)) {
    return adaptConnectMiddleware(middleware, middlewarePath);
  }

  // It's already Hono middleware, return as-is
  return middleware as MiddlewareHandler;
}

/**
 * Adapts Connect/Express middleware to work with Hono
 * Based on @hono/connect approach using node-mocks-http
 *
 * @param connectMiddleware - The Connect middleware handler
 * @param middlewarePath - The path pattern the middleware is mounted at (e.g., "/mcp-use/widgets/*")
 * @returns A Hono middleware function
 */
export async function adaptConnectMiddleware(
  connectMiddleware: any,
  middlewarePath: string
): Promise<MiddlewareHandler> {
  // Dynamically import required modules (optional dependencies)
  let createRequest: any;
  let createResponse: any;

  try {
    const httpMocks = await import("node-mocks-http");
    createRequest = httpMocks.createRequest;
    createResponse = httpMocks.createResponse;
  } catch (error) {
    console.error(
      "[WIDGETS] node-mocks-http not available. Install connect and node-mocks-http for Vite middleware support."
    );
    throw error;
  }

  // Normalize middleware path: remove trailing * and /
  let normalizedPath = middlewarePath;
  if (normalizedPath.endsWith("*")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  if (normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  const honoMiddleware: MiddlewareHandler = async (c: Context, next: Next) => {
    const request = c.req.raw;
    const parsedURL = new URL(request.url, "http://localhost");
    const query: Record<string, unknown> = {};
    for (const [key, value] of parsedURL.searchParams.entries()) {
      query[key] = value;
    }

    // Strip the middleware path prefix from the URL pathname
    // Connect middleware only sees the path without the prefix
    let middlewarePathname = parsedURL.pathname;
    if (normalizedPath && middlewarePathname.startsWith(normalizedPath)) {
      middlewarePathname = middlewarePathname.substring(normalizedPath.length);
      // Ensure path starts with / if it's not empty
      if (middlewarePathname === "") {
        middlewarePathname = "/";
      } else if (!middlewarePathname.startsWith("/")) {
        middlewarePathname = "/" + middlewarePathname;
      }
    }

    // Transform Hono request to IncomingMessage-like object
    const mockRequest = createRequest({
      method: request.method.toUpperCase(),
      url: middlewarePathname + parsedURL.search,
      headers: Object.fromEntries(request.headers.entries()),
      query,
      ...(request.body && { body: request.body }),
    });

    // Create mock response
    const mockResponse = createResponse();

    // Intercept response.end to capture the response
    let responseResolved = false;
    const res = await new Promise<Response | undefined>((resolve) => {
      const originalEnd = mockResponse.end.bind(mockResponse);

      mockResponse.end = (...args: Parameters<typeof originalEnd>) => {
        const result = originalEnd(...args);

        if (!responseResolved && mockResponse.writableEnded) {
          responseResolved = true;
          // Transform mock response to Web Response
          // Status codes 204 (No Content) and 304 (Not Modified) must not have a body
          const statusCode = mockResponse.statusCode;
          const noBodyStatuses = [204, 304];
          const responseBody = noBodyStatuses.includes(statusCode)
            ? null
            : mockResponse._getData() || mockResponse._getBuffer() || null;

          const connectResponse = new Response(responseBody, {
            status: statusCode,
            statusText: mockResponse.statusMessage,
            headers: mockResponse.getHeaders() as HeadersInit,
          });
          resolve(connectResponse);
        }

        return result;
      };

      // Handle Connect middleware
      connectMiddleware(mockRequest, mockResponse, () => {
        // Middleware called next(), check if response was already handled
        if (!responseResolved && !mockResponse.writableEnded) {
          responseResolved = true;
          // Update Hono context with Connect response headers and status
          const statusCode = mockResponse.statusCode;
          // Status codes 204 (No Content) and 304 (Not Modified) must not have a body
          const noBodyStatuses = [204, 304];
          const responseBody = noBodyStatuses.includes(statusCode)
            ? null
            : mockResponse._getData() || mockResponse._getBuffer() || null;

          // Clear existing headers properly
          // Fix for header clearing: use separate if statements, not else-if
          // This ensures headers are deleted from both #headers and #preparedHeaders
          const preparedHeaders = c.newResponse(null, 204, {}).headers;
          for (const key of [...preparedHeaders.keys()]) {
            // Delete from preparedHeaders (if exists)
            if (preparedHeaders.has(key)) {
              c.header(key, undefined);
            }
            // Also ensure it's deleted from the response headers
            if (c.res && c.res.headers.has(key)) {
              c.res.headers.delete(key);
            }
          }

          // Set Connect response headers
          const connectHeaders = mockResponse.getHeaders();
          for (const [key, value] of Object.entries(connectHeaders)) {
            if (value !== undefined) {
              c.header(
                key,
                Array.isArray(value) ? value.join(", ") : String(value)
              );
            }
          }

          c.status(statusCode as any);

          if (noBodyStatuses.includes(statusCode)) {
            // For no-body status codes, return a response without body
            resolve(c.newResponse(null, statusCode));
          } else if (responseBody) {
            resolve(c.body(responseBody));
          } else {
            resolve(undefined);
          }
        }
      });
    });

    if (res) {
      c.res = res;
      return res;
    }

    await next();
  };

  return honoMiddleware;
}
