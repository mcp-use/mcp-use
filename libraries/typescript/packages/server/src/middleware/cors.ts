import type { CorsOptions } from "../config.js";
import type { FetchMiddleware } from "../fetch-app.js";

const DEFAULT_METHODS = ["GET", "HEAD", "POST", "OPTIONS"];
const DEFAULT_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
];

function resolveAllowedOrigin(
  origin: CorsOptions["origin"],
  requestOrigin: string | null
): string | null {
  if (origin === undefined) {
    return requestOrigin;
  }
  if (typeof origin === "function") {
    return origin(requestOrigin);
  }
  if (origin === "*") {
    return "*";
  }
  if (Array.isArray(origin)) {
    if (requestOrigin !== null && origin.includes(requestOrigin)) {
      return requestOrigin;
    }
    return null;
  }
  return origin;
}

function corsHeaders(
  options: Required<
    Pick<CorsOptions, "methods" | "allowedHeaders" | "credentials">
  > &
    Pick<CorsOptions, "origin">,
  request: Request
): HeadersInit | undefined {
  if (request.headers.has("Access-Control-Allow-Origin")) {
    return undefined;
  }

  const requestOrigin = request.headers.get("Origin");
  const allowedOrigin = resolveAllowedOrigin(options.origin, requestOrigin);
  if (allowedOrigin === null) {
    return undefined;
  }

  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": options.methods.join(", "),
    "Access-Control-Allow-Headers": options.allowedHeaders.join(", "),
  };
  if (options.credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  if (allowedOrigin !== "*") {
    headers.Vary = "Origin";
  }
  return headers;
}

function mergeCorsHeaders(response: Response, headers: HeadersInit): Response {
  if (response.headers.has("Access-Control-Allow-Origin")) {
    return response;
  }
  const merged = new Headers(response.headers);
  const corsHeaders = new Headers(headers);
  corsHeaders.forEach((value, key) => {
    merged.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

/**
 * Fetch middleware that adds CORS headers to every response.
 *
 * @internal Wired from {@link MCPServer} when `ServerConfig.cors` is set.
 */
export function corsFetchMiddleware(options: CorsOptions): FetchMiddleware {
  const enabled = options.enabled !== false;
  if (!enabled) {
    return async (_request, next) => next();
  }

  const resolved = {
    ...(options.origin !== undefined && { origin: options.origin }),
    methods: options.methods ?? DEFAULT_METHODS,
    allowedHeaders: options.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    credentials: options.credentials ?? false,
  };

  return async (request, next) => {
    const headers = corsHeaders(resolved, request);
    if (headers === undefined) {
      return next();
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const response = await next();
    return mergeCorsHeaders(response, headers);
  };
}

/** Whether global CORS middleware owns response headers for view assets. */
export function isGlobalCorsEnabled(cors: CorsOptions | undefined): boolean {
  return cors !== undefined && cors.enabled !== false;
}
