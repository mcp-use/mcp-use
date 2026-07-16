import {
  createMcpHandler,
  type AuthInfo,
  type CreateMcpHandlerOptions,
  type McpHttpHandler,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

import { getRequestBag, matchesPath, type FetchHandler } from "./fetch-app.js";
import {
  extractClientCapabilitiesFromBody,
  stashClientCapabilities,
} from "./views/capabilities.js";

/** Options for {@link createMcpMount}. */
export interface MountMcpOptions {
  /** Route path the MCP endpoint is served on. Defaults to `/mcp`. */
  path?: string;
  /**
   * Options forwarded to the SDK's `createMcpHandler`.
   *
   * `legacy` defaults to `"stateless"`: 2025-era (non-envelope) requests are
   * served by a fresh instance over a session-less streamable HTTP transport.
   * Pass `legacy: "reject"` for modern-only strict serving, where
   * legacy-classified requests get the unsupported-protocol-version error.
   */
  handler?: CreateMcpHandlerOptions;
  /**
   * Produce verified {@link AuthInfo} for the request before the SDK handler
   * runs. When omitted, requests are served without authenticated identity.
   */
  authInfo?: (request: Request) => AuthInfo | undefined;
}

/** Result of {@link createMcpMount}. */
export interface McpMount {
  /** Underlying SDK handler (`close`, `notify`, `bus`). */
  handler: McpHttpHandler;
  /** Fetch handler for the MCP path only (compose into a larger app). */
  fetch: FetchHandler;
}

/**
 * Create the MCP Streamable HTTP endpoint as a fetch handler.
 *
 * Returns the underlying `McpHttpHandler` so callers can call `close()` on
 * shutdown to abort in-flight exchanges, and use `notify`/`bus` for
 * list-changed notifications.
 *
 * Compose the returned `fetch` into a larger app with {@link composeFetch}
 * from `mcp-use`, and put Host/Origin validation in front when binding
 * locally or exposing the process directly.
 *
 * @example
 * ```ts
 * const { handler, fetch: mcpFetch } = createMcpMount(factory);
 * const app = composeFetch(mcpFetch, jsonBodyMiddleware(), hostValidationMiddleware(hosts));
 * ```
 */
export function createMcpMount(
  factory: McpServerFactory,
  options: MountMcpOptions = {}
): McpMount {
  const {
    path = "/mcp",
    handler: handlerOptions,
    authInfo: getAuthInfo,
  } = options;
  const handler = createMcpHandler(factory, {
    legacy: "stateless",
    ...handlerOptions,
  });

  const fetch: FetchHandler = async (request) => {
    if (!matchesPath(request, path)) {
      return new Response("Not Found", { status: 404 });
    }

    const bag = getRequestBag(request);
    let parsedBody = bag.parsedBody;
    if (parsedBody === undefined) {
      try {
        parsedBody = await request.clone().json();
      } catch {
        // Non-JSON or empty body — the SDK handler will surface the error.
      }
    }

    const capabilities = extractClientCapabilitiesFromBody(parsedBody);
    if (capabilities !== undefined) {
      stashClientCapabilities(request, capabilities);
    }

    const authInfo = getAuthInfo?.(request) ?? bag.authInfo;
    return handler.fetch(request, {
      ...(parsedBody !== undefined && { parsedBody }),
      ...(authInfo !== undefined && { authInfo }),
    });
  };

  return { handler, fetch };
}

/**
 * @deprecated Use {@link createMcpMount} — returns the same mount without Hono.
 */
export function mountMcp(
  factory: McpServerFactory,
  options: MountMcpOptions = {}
): McpMount {
  return createMcpMount(factory, options);
}
