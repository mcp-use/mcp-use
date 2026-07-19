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
   * appends the server origin to `connectDomains` and the configured assets
   * origin (or server origin) to `resourceDomains` at emission time. Other
   * author-set fields (`frameDomains`, `baseUriDomains`, …) pass through.
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

/**
 * Compatibility manifest entry whose JS and CSS are embedded in the
 * synthesized HTML document.
 *
 * The production CLI emits {@link ExternalViewManifestEntry}; this shape
 * remains available to existing internal callers.
 */
export interface InlineViewManifestEntry {
  /** Discriminant for the embedded bundle shape. */
  kind: "inline";
  /**
   * Minified ES module source embedded in a `<script type="module">` by
   * {@link synthesizeViewDocument}.
   */
  js: string;
  /**
   * Aggregated stylesheet text embedded in a `<style>` element (empty string
   * when the view has no CSS).
   */
  css: string;
}

/**
 * External view entry loaded through stylesheet and module URLs.
 *
 * Production builds use view-relative asset paths (`assets/…`) served from
 * `${basePath}/_mcp-use/views/<name>/`, or full URLs after an
 * `MCP_ASSETS_URL` rewrite. Dev uses origin-absolute Vite paths for HMR and
 * Fast Refresh.
 */
export interface ExternalViewManifestEntry {
  /** Discriminant for the external-module shape. */
  kind: "external";
  /**
   * Module entry path. Dev: origin-absolute Vite URL (`/…`). Production:
   * view-relative path under `.mcp-use/build/views/<name>/` (`assets/…`).
   */
  entry: string;
  /**
   * Stylesheet URL paths, using the same path rules as
   * {@link ExternalViewManifestEntry.entry}.
   */
  css: string[];
  /**
   * Optional extra module-script URL paths prepended to the synthesized
   * document (dev uses this for `/@vite/client`).
   *
   * @internal
   */
  scripts?: string[];
}

/**
 * One entry in the primed views registry.
 *
 * Production builds emit {@link ExternalViewManifestEntry} with view-relative
 * asset paths or build-time-rewritten CDN URLs; `mcp-use dev` emits
 * origin-absolute Vite URLs.
 */
export type ViewManifestEntry =
  | InlineViewManifestEntry
  | ExternalViewManifestEntry;

/** Map of view name → registry entry, primed via {@link registerViews}. */
export interface ViewsManifest {
  [viewName: string]: ViewManifestEntry;
}
