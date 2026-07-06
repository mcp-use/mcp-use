/**
 * Options for the inspector shell route — the object form of
 * {@link ServerConfig.inspector}.
 */
export interface InspectorOptions {
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
}

/**
 * Server identity and behavior, passed to `new MCPServer(...)`.
 *
 * Phase 1 carries only the fields the core consumes. Fields from the old
 * package that belong to later phases (favicon, icons, websiteUrl, OAuth, …)
 * are added together with the features that read them.
 */
export interface ServerConfig {
  /** Server name reported to clients during negotiation. */
  name: string;
  /** Server version reported to clients. */
  version: string;
  /** Human-readable display name (falls back to `name`). */
  title?: string;
  /** Human-readable description of the server. */
  description?: string;
  /** Usage instructions surfaced to the model by clients. */
  instructions?: string;
  /** Route path the MCP endpoint is served on. Defaults to `/mcp`. */
  basePath?: string;
  /**
   * Hostname `listen()` binds. Defaults to `127.0.0.1`; localhost-class
   * binds get DNS-rebinding protection (Host/Origin validation)
   * automatically. Set `"0.0.0.0"` to serve publicly — behind a platform
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
   * mirrors the effective Host allowlist. Requests without an `Origin`
   * header always pass (non-browser MCP clients don't send one).
   */
  allowedOrigins?: string[];
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
   * `true`, `{}`, and leaving the field unset all mean enabled; set `false`
   * to disable the route, or pass `{ assetsUrl }` to load the bundle from a
   * self-hosted copy instead of the public CDN (air-gapped environments).
   *
   * @defaultValue `true`
   *
   * @example
   * ```ts
   * // Default: inspector served at /mcp/inspector from the public CDN.
   * new MCPServer({ name: "my-server", version: "1.0.0" });
   *
   * // Disabled:
   * new MCPServer({ name: "my-server", version: "1.0.0", inspector: false });
   *
   * // Air-gapped: load a self-hosted copy of the inspector bundle.
   * new MCPServer({
   *   name: "my-server",
   *   version: "1.0.0",
   *   inspector: { assetsUrl: "https://intranet.example.com/inspector.js" },
   * });
   * ```
   */
  inspector?: boolean | InspectorOptions;
}
