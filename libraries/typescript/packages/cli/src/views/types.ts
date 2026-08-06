/** View bundle embedded directly into a generated MCP resource. */
export interface InlineViewManifestEntry {
  kind: "inline";
  js: string;
  css: string;
}

/** View bundle served as external module and stylesheet assets. */
export interface ExternalViewManifestEntry {
  kind: "external";
  entry: string;
  css: string[];
  scripts?: string[];
}

/** CLI-owned build representation accepted structurally by `MCPServer`. */
export interface ViewsManifest {
  [viewName: string]: InlineViewManifestEntry | ExternalViewManifestEntry;
}
