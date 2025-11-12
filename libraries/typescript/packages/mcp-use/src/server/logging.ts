import type { Context, Next } from "hono";

/**
 * Request logging middleware with timestamp, colored status codes, and MCP method info
 *
 * Logs all HTTP requests with:
 * - Timestamp in HH:MM:SS.mmm format
 * - HTTP method and endpoint in bold
 * - MCP method name in brackets for POST requests to /mcp
 * - Color-coded status codes (green 2xx, yellow 3xx, red 4xx, magenta 5xx)
 *
 * @param c - Hono context object
 * @param next - Hono next function
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const timestamp = new Date().toISOString().substring(11, 23);
  const method = c.req.method;
  const url = c.req.url;

  // Get request body for MCP method logging (only for POST /mcp)
  // Clone the request before reading to avoid consuming the body stream
  // This allows subsequent handlers to read the body again
  let body: any = null;
  if (method === "POST" && url.includes("/mcp")) {
    try {
      // Clone the request to avoid consuming the original body stream
      const clonedRequest = c.req.raw.clone();
      body = await clonedRequest.json().catch(() => null);
    } catch {
      // Ignore JSON parse errors
    }
  }

  await next();

  // Get status code from response
  const statusCode = c.res.status;
  let statusColor = "";

  if (statusCode >= 200 && statusCode < 300) {
    statusColor = "\x1b[32m"; // Green for 2xx
  } else if (statusCode >= 300 && statusCode < 400) {
    statusColor = "\x1b[33m"; // Yellow for 3xx
  } else if (statusCode >= 400 && statusCode < 500) {
    statusColor = "\x1b[31m"; // Red for 4xx
  } else if (statusCode >= 500) {
    statusColor = "\x1b[35m"; // Magenta for 5xx
  }

  // Add MCP method info for POST requests to /mcp
  let logMessage = `[${timestamp}] ${method} \x1b[1m${new URL(url).pathname}\x1b[0m`;
  if (method === "POST" && url.includes("/mcp") && body?.method) {
    logMessage += ` \x1b[1m[${body.method}]\x1b[0m`;
  }
  logMessage += ` ${statusColor}${statusCode}\x1b[0m`;

  console.log(logMessage);
}
