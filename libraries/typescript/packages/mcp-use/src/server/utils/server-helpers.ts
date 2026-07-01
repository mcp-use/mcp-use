/**
 * Server Helper Utilities
 *
 * General utility functions for the MCP server.
 */

import { Hono, type Hono as HonoType } from "hono";
import { cors } from "hono/cors";
import { hostHeaderValidation } from "../middleware/host-validation.js";
import { canonicalOrigin } from "./resolve-url.js";
import { getEnv } from "./runtime.js";

/**
 * Get default CORS configuration for MCP server
 *
 * @returns CORS options object for Hono cors middleware
 */
function getDefaultCorsOptions(): Parameters<typeof cors>[0] {
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
interface CreateHonoAppOptions {
  allowedOrigins?: string[];
  cors?: Partial<Parameters<typeof cors>[0]>;
}

function parseAllowedHostname(value: string): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(trimmedValue).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${trimmedValue}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

function getAllowedHostnames(allowedOrigins?: string[]): string[] {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return [];
  }

  const hostnames = allowedOrigins
    .map((origin) => parseAllowedHostname(origin))
    .filter((hostname): hostname is string => Boolean(hostname));

  return [...new Set(hostnames)];
}

export function createHonoApp(
  requestLogger: any,
  options: CreateHonoAppOptions = {}
): HonoType {
  const app = new Hono();

  const allowedHostnames = getAllowedHostnames(options.allowedOrigins);

  if (allowedHostnames.length > 0) {
    app.use("*", hostHeaderValidation(allowedHostnames));
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
 * Get the server's canonical base URL, falling back to `host:port`.
 *
 * This is the boot-time canonical origin (no request in scope). Precedence:
 * `MCP_URL` env var → `http://host:port`. The former `config.baseUrl` branch
 * was removed in P4 — a canonical public origin is now expressed only via
 * `MCP_URL` (operator-provided) or inferred per-request from proxy headers via
 * {@link canonicalOrigin}.
 *
 * @param serverHost - Server hostname
 * @param serverPort - Server port
 * @returns The complete base URL for the server
 */
export function getServerBaseUrl(
  serverHost: string,
  serverPort: number | undefined
): string {
  return canonicalOrigin({
    fallback: `http://${serverHost}:${serverPort}`,
  });
}

/**
 * Get additional CSP URLs from the `MCP_USE_CSP_URLS` environment variable.
 * Supports a comma-separated list or a single URL.
 *
 * @returns Array of URLs to add to CSP resource_domains
 */
export function getCSPUrls(): string[] {
  const cspUrlsEnv = getEnv("MCP_USE_CSP_URLS");
  if (!cspUrlsEnv) {
    console.log("[CSP] No MCP_USE_CSP_URLS environment variable found");
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
