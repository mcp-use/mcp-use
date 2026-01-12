import type { Context, Next } from "hono";

import { getEnv } from "./utils/runtime.js";

/**
 * Check if DEBUG mode is enabled via environment variable
 */
function isDebugMode(): boolean {
  const debugEnv = getEnv("DEBUG");
  return (
    debugEnv !== undefined &&
    debugEnv !== "" &&
    debugEnv !== "0" &&
    debugEnv.toLowerCase() !== "false"
  );
}

/**
 * Format an object for logging (pretty-print JSON)
 */
function formatForLogging(obj: any): string {
  function truncate(val: any): any {
    if (typeof val === "string" && val.length > 100) {
      return val.slice(0, 100) + "...";
    } else if (Array.isArray(val)) {
      return val.map(truncate);
    } else if (val && typeof val === "object") {
      const result: Record<string, any> = {};
      for (const key in val) {
        if (Object.prototype.hasOwnProperty.call(val, key)) {
          result[key] = truncate(val[key]);
        }
      }
      return result;
    }
    return val;
  }
  try {
    return JSON.stringify(truncate(obj), null, 2);
  } catch {
    return String(obj);
  }
}

/**
 * Middleware that logs incoming HTTP requests with a timestamp, color-coded status code, and optional debug details.
 *
 * Skips logging for inspector telemetry and RPC endpoints under /inspector/api/tel/, /inspector/api/rpc/stream, and /inspector/api/rpc/log.
 * For POST requests to /mcp, includes the MCP method name when present. When DEBUG is enabled, logs request headers/body and response headers/body.
 *
 * @param c - Hono context for the current request/response
 * @param next - Next middleware function to invoke
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const timestamp = new Date().toISOString().substring(11, 23);
  const method = c.req.method;
  const url = c.req.url;
  const debugMode = isDebugMode();

  // Filter out noisy endpoints that create log spam
  const pathname = new URL(url).pathname;
  const noisyPaths = [
    "/inspector/api/tel/", // Telemetry endpoints (posthog, scarf)
    "/inspector/api/rpc/stream", // RPC stream (SSE)
    "/inspector/api/rpc/log", // RPC log endpoint
  ];

  // Skip logging for noisy paths but still process the request
  if (noisyPaths.some((noisyPath) => pathname.startsWith(noisyPath))) {
    await next();
    return;
  }

  // Get request body for logging
  let requestBody: any = null;
  let requestHeaders: Record<string, string> = {};

  if (debugMode) {
    // Log request headers - c.req.header() without args returns all headers
    const allHeaders = c.req.header();
    if (allHeaders) {
      requestHeaders = allHeaders;
    }
  }

  // Get request body (for MCP method logging or full debug logging)
  if (method !== "GET" && method !== "HEAD") {
    try {
      // Clone the request to avoid consuming the original body stream
      const clonedRequest = c.req.raw.clone();
      requestBody = await clonedRequest.json().catch(() => {
        // If JSON parsing fails, try to get as text
        return clonedRequest.text().catch(() => null);
      });
    } catch {
      // Ignore errors
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
  if (method === "POST" && url.includes("/mcp") && requestBody?.method) {
    logMessage += ` \x1b[1m[${requestBody.method}]\x1b[0m`;
  }
  logMessage += ` ${statusColor}${statusCode}\x1b[0m`;

  console.log(logMessage);

  // Debug mode: log detailed request/response information
  if (debugMode) {
    console.log("\n\x1b[36m" + "=".repeat(80) + "\x1b[0m");
    console.log("\x1b[1m\x1b[36m[DEBUG] Request Details\x1b[0m");
    console.log("\x1b[36m" + "-".repeat(80) + "\x1b[0m");

    // Request headers
    if (Object.keys(requestHeaders).length > 0) {
      console.log("\x1b[33mRequest Headers:\x1b[0m");
      console.log(formatForLogging(requestHeaders));
    }

    // Request body
    if (requestBody !== null) {
      console.log("\x1b[33mRequest Body:\x1b[0m");
      if (typeof requestBody === "string") {
        console.log(requestBody);
      } else {
        console.log(formatForLogging(requestBody));
      }
    }

    // Response headers
    const responseHeaders: Record<string, string> = {};
    c.res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    if (Object.keys(responseHeaders).length > 0) {
      console.log("\x1b[33mResponse Headers:\x1b[0m");
      console.log(formatForLogging(responseHeaders));
    }

    // Response body
    try {
      // Check if response has a body and can be cloned
      // Clone the response to read the body without consuming the original stream
      // This ensures the original response remains intact for the client
      if (c.res.body !== null && c.res.body !== undefined) {
        try {
          const clonedResponse = c.res.clone();
          const responseBody = await clonedResponse.text().catch(() => null);

          if (responseBody !== null && responseBody.length > 0) {
            console.log("\x1b[33mResponse Body:\x1b[0m");
            // Try to parse as JSON for pretty printing
            try {
              const jsonBody = JSON.parse(responseBody);
              console.log(formatForLogging(jsonBody));
            } catch {
              // Not JSON, print as text (truncate if too long)
              const maxLength = 10000;
              if (responseBody.length > maxLength) {
                console.log(
                  responseBody.substring(0, maxLength) +
                    `\n... (truncated, ${responseBody.length - maxLength} more characters)`
                );
              } else {
                console.log(responseBody);
              }
            }
          } else {
            console.log("\x1b[33mResponse Body:\x1b[0m (empty)");
          }
        } catch (cloneError) {
          // If cloning fails (e.g., response already consumed), log that
          console.log("\x1b[33mResponse Body:\x1b[0m (unable to clone/read)");
        }
      } else {
        console.log("\x1b[33mResponse Body:\x1b[0m (no body)");
      }
    } catch (error) {
      // If we can't read the response body, log that
      console.log("\x1b[33mResponse Body:\x1b[0m (unable to read)");
    }

    console.log("\x1b[36m" + "=".repeat(80) + "\x1b[0m\n");
  }
}
