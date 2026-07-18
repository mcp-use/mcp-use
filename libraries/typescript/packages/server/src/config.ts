import type { Icon, ServerOptions } from "@modelcontextprotocol/server";

import type { LoggingOptions } from "./logging.js";
import type { OAuthProvider } from "./oauth/index.js";

/**
 * Options for the inspector shell route — the shape of
 * {@link ServerConfig.inspector}.
 */
export interface InspectorOptions {
  /**
   * Whether the inspector shell route is mounted.
   *
   * @defaultValue `true`
   */
  enabled?: boolean;
  /**
   * Full replacement URL for the inspector bundle script (FastAPI's
   * `swagger_js_url` analog). The shell's `<script type="module">` loads
   * exactly this URL, so it must point at a complete copy of the
   * `@mcp-use/inspector` CDN bundle (`dist/cdn/inspector.js`) — self-host it
   * for air-gapped environments where the public CDN is unreachable.
   *
   * @defaultValue The mcp-use CDN URL for the `@mcp-use/inspector` bundle,
   * pinned to the current version.
   */
  assetsUrl?: string;
  /**
   * Hosted managed-chat backend URL (injected as `window.__MANUFACT_CHAT_URL__`).
   * Defaults to `process.env.MANUFACT_CHAT_URL` when the shell is mounted.
   */
  manufactChatUrl?: string;
}

/**
 * Common server identity and behavior, passed to `new MCPServer(...)`.
 *
 * Includes the fields consumed by the core HTTP and OAuth resource-server
 * wiring. Other legacy configuration is added with the feature that reads it.
 */
interface BaseServerConfig {
  /** Server name reported to clients during negotiation. */
  name: string;
  /** Server version reported to clients. */
  version: string;
  /** Human-readable display name (falls back to `name`). */
  title?: string;
  /**
   * Human-readable description of the server, reported to clients as
   * implementation metadata during negotiation.
   */
  description?: string;
  /**
   * Browser favicon source.
   *
   * Accepts a safe path relative to the project `public/` directory, an
   * absolute HTTP(S) URL, or an image data URL. The selected image is served
   * at the root-level `/favicon.ico` route. When omitted, the `icons` field
   * selects the favicon using ICO, small PNG, any PNG, then first-icon order.
   * An explicit value always wins; an empty string is invalid.
   *
   * @defaultValue Inferred from `icons`, or no favicon when `icons` is absent
   * or empty.
   * @throws TypeError When the value is empty, uses an unsupported URL scheme,
   * or is an unsafe local path.
   *
   * @example
   * ```ts
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   favicon: "brand/favicon.svg",
   * });
   * ```
   */
  favicon?: string;
  /**
   * Server icons reported to clients in MCP implementation metadata.
   *
   * Uses the official SDK {@link Icon} shape. Each `src` accepts a safe path
   * relative to `public/`, an absolute HTTP(S) URL, or an image data URL.
   * Local paths become request-scoped absolute URLs under
   * `${basePath}/_mcp-use/public/`; author order is preserved on the wire.
   * When `favicon` is omitted, these icons also select `/favicon.ico`.
   * An empty array is valid and selects no favicon.
   *
   * @defaultValue `undefined`
   * @throws TypeError When an icon has an invalid source, MIME type, sizes,
   * or theme.
   *
   * @example
   * ```ts
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   icons: [
   *     { src: "brand/icon.svg", mimeType: "image/svg+xml" },
   *     { src: "brand/icon-32.png", mimeType: "image/png", sizes: ["32x32"] },
   *   ],
   * });
   * ```
   */
  icons?: Icon[];
  /**
   * Absolute HTTP(S) URL for the server's website or documentation, reported
   * to clients in MCP implementation metadata.
   *
   * @defaultValue `undefined`
   * @throws TypeError When the value is empty, relative, or not HTTP(S).
   *
   * @example
   * ```ts
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   websiteUrl: "https://example.com/my-server",
   * });
   * ```
   */
  websiteUrl?: string;
  /** Usage instructions surfaced to the model by clients. */
  instructions?: string;
  /**
   * Route path the MCP endpoint is served on.
   *
   * Must be an absolute URL pathname: starts with `/`, and contains no `?`,
   * `#`, whitespace, empty path segments (`//`), or trailing slash (except
   * for the root path `/`).
   *
   * @defaultValue `"/mcp"`
   * @throws TypeError When the value fails the pathname rules above
   * (validated by {@link assertServerConfig}).
   */
  basePath?: string;
  /**
   * Hostname `listen()` binds. Defaults to `127.0.0.1`; localhost-class
   * binds get DNS-rebinding protection (`Host` on every request; `Origin`
   * only on non-GET/HEAD) automatically. Set `"0.0.0.0"` to serve publicly — behind a platform
   * edge (Railway, Fly, …) nothing more is needed, since the edge only
   * routes hostnames assigned to the deployment. Ignored by `getHandler()`,
   * which never binds.
   */
  host?: string;
  /**
   * Extra allowed hostnames for Host-header validation (DNS-rebinding
   * protection), e.g. `["api.example.com"]`. Port-agnostic and additive:
   * localhost-class hostnames stay allowed, so local runs keep working
   * unmodified. Setting this also turns Host validation on for
   * `getHandler()`, which otherwise applies none.
   */
  allowedHosts?: string[];
  /**
   * Extra allowed origin hostnames for Origin-header validation
   * (port-agnostic, additive to the localhost-class origins). When unset,
   * mirrors the effective Host allowlist. Origin is validated only on
   * non-GET/HEAD requests (sandboxed view iframes send `Origin: null` on
   * asset GETs; the MCP wire is POST). Requests without an `Origin` header
   * always pass (non-browser MCP clients don't send one).
   */
  allowedOrigins?: string[];
  /**
   * How 2025-era (non-envelope) requests are served.
   *
   * `"stateless"` answers each legacy request with a fresh instance over a
   * session-less streamable HTTP transport (2025 session operations — GET and
   * DELETE — get `405`). `"reject"` is modern-only strict: legacy-classified
   * requests are refused with the unsupported-protocol-version error naming
   * the supported revisions.
   *
   * @defaultValue `"stateless"`
   */
  legacy?: "stateless" | "reject";
  /**
   * Expose the HTML landing page without bearer authentication when OAuth is
   * configured.
   *
   * The landing page itself is always mounted at `basePath` for browser GET
   * and HEAD requests that explicitly accept `text/html`. Without OAuth it is
   * public. With OAuth, it requires a valid bearer token unless this option is
   * `true`. MCP protocol requests remain protected in either case.
   *
   * @defaultValue `false`
   */
  publicLandingPage?: boolean;
  /**
   * Inspector shell route at `${basePath}/inspector` — a browser UI for
   * exploring and calling the server's tools, resources, and prompts.
   *
   * @remarks
   * Follows the FastAPI `/docs` model: the server itself ships only a tiny
   * dependency-free HTML page whose `<script type="module">` loads the
   * `@mcp-use/inspector` bundle from a CDN (pinned to the current inspector
   * version), so the UI updates independently of SDK releases and adds
   * nothing to the install. The page tells the inspector to connect to this
   * server's MCP endpoint at `basePath`, deriving the URL from the browser's
   * own origin.
   *
   * Enabled by default; set `{ enabled: false }` to disable the route, or
   * pass `{ assetsUrl }` to load the bundle from a self-hosted copy instead
   * of the public CDN (air-gapped environments). For local development,
   * `MCP_USE_INSPECTOR_ASSETS_URL` provides the same override without changing
   * application code; an explicit `assetsUrl` takes precedence.
   *
   * @example
   * ```ts
   * // Default: inspector served at /mcp/inspector from the public CDN.
   * new MCPServer({ name: "my-server", version: "1.0.0" });
   *
   * // Disabled:
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   inspector: { enabled: false },
   * });
   *
   * // Air-gapped: load a self-hosted copy of the inspector bundle.
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   inspector: { assetsUrl: "https://intranet.example.com/inspector.js" },
   * });
   * ```
   */
  inspector?: InspectorOptions;
  /**
   * HTTP/MCP request logging: one summary line per request plus an indented
   * detail line naming the MCP method, its subject (tool name, resource URI,
   * prompt name), and the calling client.
   *
   * Enabled at the `info` level by default, which prints no request or
   * response payloads. Set `{ enabled: false }` to disable,
   * `{ level: "debug" }` to echo compact truncated tool/prompt input and
   * tool output on the detail line, or `{ level: "trace" }` for debug plus
   * full request/response header and body dumps. The `MCP_USE_LOG_LEVEL`
   * environment variable (`info` | `debug` | `trace`) overrides the
   * configured level.
   */
  logging?: LoggingOptions;
  /**
   * Integrity verification for `requestState` echoed across
   * `input_required` rounds.
   *
   * Use the SDK's `createRequestStateCodec(...).verify` here when state
   * affects authorization, resource access, or business logic. Without a
   * verifier, {@link RequestContext.requestState} returns the raw,
   * attacker-controlled wire string.
   *
   * @defaultValue `undefined`
   */
  requestState?: ServerOptions["requestState"];
  /**
   * Optional CORS headers on every route served by `getHandler()` / `listen()`
   * (MCP endpoint, view assets, inspector, OAuth metadata). Off when omitted.
   *
   * Pair with {@link BaseServerConfig.allowedOrigins | allowedOrigins} for
   * browser clients: CORS tells the browser it may read the response; Origin
   * validation decides whether the server accepts the request.
   *
   * @example
   * ```ts
   * new MCPServer({
   *   name: "api",
   *   version: "1.0.0",
   *   allowedOrigins: ["app.example.com"],
   *   cors: {
   *     origin: "https://app.example.com",
   *     credentials: true,
   *   },
   * });
   * ```
   */
  cors?: CorsOptions;
}

/**
 * CORS configuration for routes owned by mcp-use (`getHandler()` / `listen()`).
 *
 * Omit `cors` entirely for the current no-CORS behavior. Pass `cors: {}` to
 * enable with defaults (reflects the request `Origin` when present; wildcard
 * `origin: "*"` requires an explicit opt-in).
 */
export interface CorsOptions {
  /** @defaultValue `true` when `cors` is set; ignored when `cors` is omitted */
  enabled?: boolean;
  /** Allowed Origin(s). Reflect matching `Origin` header, or `"*"` when set. */
  origin?: string | string[] | ((origin: string | null) => string | null);
  /** @defaultValue `["GET", "HEAD", "POST", "OPTIONS"]` */
  methods?: string[];
  /** @defaultValue common MCP + JSON headers */
  allowedHeaders?: string[];
  /** @defaultValue `false` */
  credentials?: boolean;
}

/**
 * Runtime checks for optional {@link ServerConfig} fields that TypeScript
 * alone cannot enforce when values arrive from untyped call sites.
 *
 * @throws TypeError When `basePath` is present but not an absolute URL
 * pathname without empty segments, trailing slash, query, fragment, or
 * whitespace.
 */
export function assertServerConfig(config: { basePath?: unknown }): void {
  if (config.basePath !== undefined) {
    if (typeof config.basePath !== "string") {
      throw new TypeError(
        "basePath must be an absolute URL pathname without empty segments, trailing slash, query, fragment, or whitespace"
      );
    }
    const { basePath } = config;
    if (
      !basePath.startsWith("/") ||
      basePath.includes("?") ||
      basePath.includes("#") ||
      /\s/.test(basePath) ||
      basePath.includes("//") ||
      (basePath.length > 1 && basePath.endsWith("/"))
    ) {
      throw new TypeError(
        "basePath must be an absolute URL pathname without empty segments, trailing slash, query, fragment, or whitespace"
      );
    }
  }
}

/**
 * Server identity and behavior, passed to `new MCPServer(...)`.
 *
 * A user type other than `never` requires an OAuth provider, preventing a
 * callback from declaring authenticated context without authentication at
 * runtime. Omitting the type keeps the no-OAuth API ergonomic.
 */
export type ServerConfig<TUser = never> = BaseServerConfig &
  ([TUser] extends [never]
    ? {
        /** OAuth is unavailable when no authenticated user type is declared. */
        oauth?: undefined;
      }
    : {
        /**
         * External OAuth resource-server provider. Callback contexts receive
         * this provider's user type as required `ctx.auth.user`.
         */
        oauth: OAuthProvider<TUser>;
      });
