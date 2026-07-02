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
}
