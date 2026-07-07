/**
 * Sandbox permissions a view may request from the host.
 *
 * Vendored from the MCP Apps extension spec (`ext-apps` `spec.types.ts`);
 * kept server-side without importing ext-apps.
 */
export interface UiPermissions {
  /** Request camera access inside the view iframe. */
  camera?: Record<string, never>;
  /** Request microphone access inside the view iframe. */
  microphone?: Record<string, never>;
  /** Request geolocation access inside the view iframe. */
  geolocation?: Record<string, never>;
  /** Request clipboard-write access inside the view iframe. */
  clipboardWrite?: Record<string, never>;
}

/**
 * Resource-level facts about a view; named-exported as `metadata` from
 * `view.tsx`.
 */
export interface ViewMetadata {
  /** Human-readable description → the resource's `description`. */
  description?: string;
  /**
   * CSP domains the host must allow → resource `_meta.ui.csp`. The framework
   * auto-appends its own serving origin to `resourceDomains` at emission time.
   */
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };
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
  /** Resource-level metadata extracted at build/dev time from the view module. */
  metadata: ViewMetadata;
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
