import type { Context, Next } from "hono";

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
) {
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

  return async (c: Context, next: Next) => {
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
              c.header(key, Array.isArray(value) ? value.join(", ") : String(value));
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
}

