/** Static frontend configuration included in generated view manifests. */
export interface ViewConfig {
  /** Whether the browser automatically reports view size changes. */
  autoResize?: boolean;
  /** Supported browser display modes; must include inline. */
  displayModes?: readonly ("inline" | "fullscreen" | "pip")[];
  /** Initial ChatGPT display preference; must belong to displayModes. */
  preferredDisplayMode?: "inline" | "fullscreen";
}

// This structural build contract intentionally mirrors the server view
// manifest. Keep both shapes aligned without adding a CLI-to-server import.
/** View bundle embedded directly into a generated MCP resource. */
export interface InlineViewManifestEntry {
  kind: "inline";
  /** Extracted frontend configuration. */
  viewConfig?: ViewConfig | undefined;
  js: string;
  css: string;
}

/** View bundle served as external module and stylesheet assets. */
export interface ExternalViewManifestEntry {
  kind: "external";
  /** Extracted frontend configuration. */
  viewConfig?: ViewConfig | undefined;
  entry: string;
  css: string[];
  scripts?: string[];
}

/** CLI-owned build representation accepted structurally by `MCPServer`. */
export interface ViewsManifest {
  [viewName: string]: InlineViewManifestEntry | ExternalViewManifestEntry;
}
