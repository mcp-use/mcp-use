/**
 * Server Helper Utilities
 *
 * General utility functions for the MCP server.
 */

import { Hono, type Hono as HonoType } from "hono";
import { cors } from "hono/cors";
import { hostHeaderValidation } from "../middleware/host-validation.js";
import type { OriginResolver, ResolveResult } from "./origin-resolver.js";
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
 * Sets up CORS and request logging middleware for the MCP server. When an
 * `originResolver` is provided AND the user actually configured
 * `allowedOrigins`, Host validation middleware is installed globally.
 *
 * @param requestLogger - Request logging middleware function
 * @param options.originResolver - Resolver driving Host validation
 * @param options.cors - Custom CORS options
 * @returns Configured Hono app instance
 */
interface CreateHonoAppOptions {
  originResolver?: OriginResolver;
  cors?: Partial<Parameters<typeof cors>[0]>;
}

export function createHonoApp(
  requestLogger: any,
  options: CreateHonoAppOptions = {}
): HonoType {
  const app = new Hono();

  // Only enable Host validation when the user actually configured
  // `allowedOrigins`. Resolvers built from an empty/absent config are no-ops.
  if (options.originResolver && options.originResolver.isEnabled()) {
    app.use("*", hostHeaderValidation(options.originResolver));
  }

  // Enable CORS by default, with optional config overrides
  app.use(
    "*",
    cors(
      (options.cors ?? getDefaultCorsOptions()) as Parameters<typeof cors>[0]
    )
  );

  // Request logging middleware
  app.use("*", requestLogger);

  // Remove X-Frame-Options to allow cross-origin iframe embedding
  // This is needed for MCP Apps sandboxed iframe architecture where:
  // - The main inspector runs on localhost:PORT
  // - The sandbox proxy runs on 127.0.0.1:PORT (different origin for security)
  // - Widget assets need to be loadable from within the sandboxed iframe
  app.use("*", async (c, next) => {
    await next();
    // Remove X-Frame-Options as it conflicts with frame-ancestors CSP
    // and prevents legitimate cross-origin iframe embedding
    c.res.headers.delete("X-Frame-Options");
  });

  return app;
}

/**
 * Normalize a URL by replacing 0.0.0.0 with localhost.
 * 0.0.0.0 is valid for server binding (listen on all interfaces)
 * but browsers cannot connect to it as a destination address.
 *
 * @param url - URL that may contain 0.0.0.0
 * @returns URL with 0.0.0.0 replaced by localhost
 */
function normalizeUrlHost(url: string): string {
  return url.replace(/\/\/0\.0\.0\.0(:|\/|$)/, "//localhost$1");
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
  let url: string;

  // First check if baseUrl was explicitly set in config
  if (serverBaseUrl) {
    url = serverBaseUrl;
  } else {
    // Then check MCP_URL environment variable
    const mcpUrl = getEnv("MCP_URL");
    if (mcpUrl) {
      url = mcpUrl;
    } else {
      // Finally fall back to host:port
      url = `http://${serverHost}:${serverPort}`;
    }
  }

  // Normalize 0.0.0.0 to localhost for browser-accessible URLs
  return normalizeUrlHost(url);
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
    return [];
  }

  // Split by comma and trim whitespace
  const urls = cspUrlsEnv
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return urls;
}

/**
 * Resolve the effective base URL + allow-list for a given request using
 * the optional `OriginResolver`. When no resolver is configured (or the
 * request Host isn't allow-listed), falls back to the static `baseUrl`.
 *
 * Designed for use inside widget read callbacks via `getRequestContext()`.
 *
 * @param req - Incoming request (Web `Request` or Hono-compatible object)
 * @param resolver - Optional OriginResolver; when absent, always uses fallback
 * @param fallback - Fallback base URL (typically the configured baseUrl)
 * @returns Resolved origin and whether the request Host was allow-listed
 */
export function resolveBaseUrlForRequest(
  req:
    | { headers: { get(name: string): string | null }; url?: string }
    | undefined,
  resolver: OriginResolver | undefined,
  fallback: string | null | undefined
): ResolveResult {
  if (!resolver || !resolver.isEnabled() || !req) {
    return {
      origin: fallback ?? "",
      isAllowed: false,
      requestHostname: null,
    };
  }

  const result = resolver.resolveRequest(req);
  if (!result.isAllowed && !result.origin && fallback) {
    return { ...result, origin: fallback };
  }
  return result;
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
