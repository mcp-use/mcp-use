import type { Plugin } from "vite";

/** A discovered browser view. */
export interface DiscoveredView {
  /** View directory name. */
  name: string;
  /** Absolute component path. */
  entryPath: string;
}
/** Discover view entries beneath a project directory. */
export declare function discoverViews(
  root: string,
  directory?: string
): DiscoveredView[];
/** Construct live Vite URLs for discovered views. */
export declare function buildDevViewsManifest(views: DiscoveredView[]): Record<
  string,
  {
    kind: "external";
    entry: string;
    css: string[];
    scripts: string[];
  }
>;
/** Return a view's virtual module identifier. */
export declare function virtualViewId(name: string): string;
/** Test whether a file is a view entry. */
export declare function isViewEntryPath(
  file: string,
  root: string,
  directory?: string
): boolean;
/** Create browser view modules with optional React Refresh support. */
export declare function mcpUseViewsPlugin(options: {
  getViews: () => DiscoveredView[];
  /** Include the CLI-managed Tailwind stylesheet. Defaults to true. */
  tailwind?: boolean;
  /** Environment names that compile view modules. */
  environments?: string[];
  dev?: { reactRefresh: boolean };
}): Plugin;

/** Refresh generated view tool typings without replacing user-owned files. */
export declare function syncMcpEnvDeclaration(
  root: string,
  entry: string
): Promise<"created" | "updated" | "unchanged" | "user-owned">;
