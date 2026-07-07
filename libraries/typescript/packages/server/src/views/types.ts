import type {
  McpUiResourceCsp,
  McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps";

/**
 * Sandbox permissions a view may request from the host.
 *
 * Alias of the canonical MCP Apps spec type
 * {@link McpUiResourcePermissions} from `@modelcontextprotocol/ext-apps`.
 * Type-only — no runtime import of ext-apps enters the server bundle.
 */
export type UiPermissions = McpUiResourcePermissions;

/**
 * Resource-level facts declared on a bound tool's `view:` config and emitted
 * on the view resource at registration time.
 */
export interface ViewResourceFacts {
  /** Human-readable description → the resource's `description`. */
  description?: string;
  /**
   * CSP domains the host must allow → resource `_meta.ui.csp`. The framework
   * auto-appends its serving origin to `resourceDomains` at emission time;
   * other author-set fields (`frameDomains`, `baseUriDomains`, …) pass through.
   */
  csp?: McpUiResourceCsp;
  /** Sandbox permissions the view needs → `_meta.ui.permissions`. */
  permissions?: UiPermissions;
  /**
   * Dedicated origin hint for hosts that render views on a separate domain →
   * `_meta.ui.domain`.
   */
  domain?: string;
  /** Ask the host to draw a border around the view → `_meta.ui.prefersBorder`. */
  prefersBorder?: boolean;
}

/** One entry in the primed views manifest. */
export interface ViewManifestEntry {
  /**
   * Asset path relative to `.mcp-use/build/` (production), or an
   * origin-absolute URL path starting with `/` (dev: the Vite client-env
   * module URL).
   */
  entry: string;
  /** Stylesheet paths, using the same path rules as {@link ViewManifestEntry.entry}. */
  css: string[];
  /**
   * Optional extra module-script URL paths prepended to the synthesized
   * document (dev uses this for `/@vite/client`).
   *
   * @internal
   */
  scripts?: string[];
}

/** Map of view name → manifest entry, primed via {@link registerViews}. */
export interface ViewsManifest {
  [viewName: string]: ViewManifestEntry;
}
