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
   * Hostname `listen()` binds and Host validation keys off. Defaults to
   * `127.0.0.1`; localhost-class hosts get DNS-rebinding protection
   * automatically. Set `"0.0.0.0"` together with `allowedHosts` to serve
   * publicly.
   */
  host?: string;
  /**
   * Allowed hostnames for Host-header validation (DNS-rebinding protection)
   * when binding non-localhost, e.g. `["api.example.com"]`. Port-agnostic.
   */
  allowedHosts?: string[];
  /**
   * Allowed origin hostnames for Origin-header validation. Requests without
   * an `Origin` header always pass (non-browser MCP clients don't send one).
   */
  allowedOrigins?: string[];
}
