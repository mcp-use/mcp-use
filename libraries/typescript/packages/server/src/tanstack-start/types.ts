import type { SkillsSnapshot } from "../skills/types.js";
import type { EmbeddedViewAssets, ViewsManifest } from "../views/types.js";

/** Build-time data bundled into the TanStack Start server. @internal */
export interface TanStackStartBuild {
  /** MCP endpoint configured by the Vite plugin. */
  basePath: string;
  /** Compiled view registration data. */
  views: ViewsManifest;
  /** Static files served below the MCP asset subtree. */
  assets: EmbeddedViewAssets;
  /** Skills captured while building the authored server. */
  skills?: SkillsSnapshot;
}
