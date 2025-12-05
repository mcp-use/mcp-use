/**
 * Server Helper Utilities
 *
 * General utility functions for the MCP server.
 */

import { Hono, type Hono as HonoType } from "hono";
import { cors } from "hono/cors";
import { getEnv } from "./runtime.js";

/**
 * Get default CORS configuration for MCP server
 *
 * @returns CORS options object for Hono cors middleware
 */
export function getDefaultCorsOptions(): Parameters<typeof cors>[0] {
  return {
    origin: "*",
    allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "mcp-protocol-version",
      "mcp-session-id",
      "X-Proxy-Token",
      "X-Target-URL",
    ],
    // Expose mcp-session-id so browser clients can read it from responses
    exposeHeaders: ["mcp-session-id"],
  };
}

/**
 * Create and configure a new Hono app instance with default middleware
 *
 * Sets up CORS and request logging middleware for the MCP server.
 *
 * @param requestLogger - Request logging middleware function
 * @returns Configured Hono app instance
 */
export function createHonoApp(requestLogger: any): HonoType {
  const app = new Hono();

  // Enable CORS by default
  app.use("*", cors(getDefaultCorsOptions()));

  // Request logging middleware
  app.use("*", requestLogger);

  return app;
}

/**
 * Get the server base URL with fallback to host:port if not configured
 *
 * @param serverBaseUrl - Explicitly configured base URL
 * @param serverHost - Server hostname
 * @param serverPort - Server port
 * @returns The complete base URL for the server
 */
export function getServerBaseUrl(
  serverBaseUrl: string | undefined,
  serverHost: string,
  serverPort: number | undefined
): string {
  // First check if baseUrl was explicitly set in config
  if (serverBaseUrl) {
    return serverBaseUrl;
  }
  // Then check MCP_URL environment variable
  const mcpUrl = getEnv("MCP_URL");
  if (mcpUrl) {
    return mcpUrl;
  }
  // Finally fall back to host:port
  return `http://${serverHost}:${serverPort}`;
}

/**
 * Get additional CSP URLs from environment variable
 * Supports comma-separated list or single URL
 *
 * @returns Array of URLs to add to CSP resource_domains
 */
export function getCSPUrls(): string[] {
  const cspUrlsEnv = getEnv("CSP_URLS");
  if (!cspUrlsEnv) {
    console.log("[CSP] No CSP_URLS environment variable found");
    return [];
  }

  // Split by comma and trim whitespace
  const urls = cspUrlsEnv
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  console.log("[CSP] Parsed CSP URLs:", urls);
  return urls;
}

/**
 * Wait for transport.handleRequest to complete and response to be written
 *
 * Wraps the transport.handleRequest call in a Promise that only resolves when
 * expressRes.end() is called, ensuring all async operations complete before
 * we attempt to read the response.
 *
 * @param transport - The transport instance
 * @param expressReq - Express-like request object
 * @param expressRes - Express-like response object
 * @param body - Optional request body
 * @returns Promise that resolves when the request is complete
 */
export function waitForRequestComplete(
  transport: any,
  expressReq: any,
  expressRes: any,
  body?: any
): Promise<void> {
  return new Promise<void>((resolve) => {
    const originalEnd = expressRes.end;
    expressRes.end = (...args: any[]) => {
      originalEnd.apply(expressRes, args);
      resolve();
    };
    transport.handleRequest(expressReq, expressRes, body);
  });
}

/**
 * Log registered tools, prompts, and resources to console
 *
 * @param registeredTools - Array of registered tool names
 * @param registeredPrompts - Array of registered prompt names
 * @param registeredResources - Array of registered resource names
 */
export function logRegisteredItems(
  registeredTools: string[],
  registeredPrompts: string[],
  registeredResources: string[]
): void {
  console.log("\n📋 Server exposes:");
  console.log(`   Tools: ${registeredTools.length}`);
  if (registeredTools.length > 0) {
    registeredTools.forEach((name) => {
      console.log(`      - ${name}`);
    });
  }
  console.log(`   Prompts: ${registeredPrompts.length}`);
  if (registeredPrompts.length > 0) {
    registeredPrompts.forEach((name) => {
      console.log(`      - ${name}`);
    });
  }
  console.log(`   Resources: ${registeredResources.length}`);
  if (registeredResources.length > 0) {
    registeredResources.forEach((name) => {
      console.log(`      - ${name}`);
    });
  }
  console.log("");
}

/**
 * Parse parameter values from a URI based on a template
 *
 * Extracts parameter values from an actual URI by matching it against a URI template.
 * The template contains placeholders like {param} which are extracted as key-value pairs.
 *
 * @param template - URI template with placeholders (e.g., "user://{userId}/posts/{postId}")
 * @param uri - Actual URI to parse (e.g., "user://123/posts/456")
 * @returns Object mapping parameter names to their values
 *
 * @example
 * ```typescript
 * const params = parseTemplateUri("user://{userId}/posts/{postId}", "user://123/posts/456")
 * // Returns: { userId: "123", postId: "456" }
 * ```
 */
export function parseTemplateUri(
  template: string,
  uri: string
): Record<string, string> {
  const params: Record<string, string> = {};

  // Convert template to a regex pattern
  // Escape special regex characters except {}
  let regexPattern = template.replace(/[.*+?^$()[\]\\|]/g, "\\$&");

  // Replace {param} with named capture groups
  const paramNames: string[] = [];
  regexPattern = regexPattern.replace(/\{([^}]+)\}/g, (_, paramName) => {
    paramNames.push(paramName);
    return "([^/]+)";
  });

  const regex = new RegExp(`^${regexPattern}$`);
  const match = uri.match(regex);

  if (match) {
    paramNames.forEach((paramName, index) => {
      params[paramName] = match[index + 1];
    });
  }

  return params;
}
