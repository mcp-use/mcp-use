/**
 * The per-project `.mcp-use/` workspace convention — the Next.js `.next`
 * analog. Everything tooling writes for a project lives under this single,
 * gitignored directory so a checkout stays clean and `rm -rf .mcp-use` is
 * always safe.
 *
 * The layout is a fixed convention, not configuration: there is deliberately
 * no config file and no `outDir` knob (runtime/project configuration lives on
 * the `MCPServer` constructor).
 *
 * This module is PURE: it only derives path strings (no filesystem access).
 *
 * Layout (relative to the project root):
 *
 * ```text
 * .mcp-use/
 * ├─ build/        ← compiled server + manifest.json (this package)
 * ├─ generated/    ← output of the reserved typegen escape-hatch command
 * ├─ cache/        ← disposable dev/build scratch
 * ├─ state/        ← mutable runtime state (e.g. tunnel.json)
 * └─ cloud/        ← cloud linkage (link.json)
 * ```
 *
 * `build/` must contain NO mutable runtime state (that is `state/`'s job) so
 * build output stays reproducible and disposable. This is the per-project
 * workspace, distinct from the global `~/.mcp-use/` store (CLI auth,
 * credentials, per-user caches).
 */

import { join } from "node:path";
import type { ViewsManifest } from "../views/types.js";

/**
 * Fixed name of the per-project workspace directory.
 *
 * @internal
 */
export const WORKSPACE_DIR_NAME = ".mcp-use";

/**
 * Basename of the build manifest written inside the build output directory.
 *
 * @internal
 */
export const BUILD_MANIFEST_NAME = "manifest.json";

/**
 * Manifest written to `.mcp-use/build/manifest.json` by {@link runBuild} and
 * read back by `mcp-use start`.
 *
 * @internal
 */
export interface BuildManifest {
  /** Unique identifier for this build (random hex, regenerated per build). */
  buildId: string;
  /**
   * Filename of the emitted server entry, relative to the build directory
   * (e.g. `"index.js"`). `mcp-use start` imports `<build>/<entryPoint>` and
   * serves its default export.
   */
  entryPoint: string;
  /** ISO-8601 timestamp of when the build finished. */
  createdAt: string;
  /** Mode-neutral view registration data consumed by runtime adapters. */
  views: ViewsManifest;
}

/**
 * Every resolved path for a project's `.mcp-use/` workspace.
 *
 * @internal
 */
interface WorkspacePaths {
  /** The project root (the directory containing `.mcp-use/`). */
  projectRoot: string;
  /** The `.mcp-use/` workspace directory. */
  workspace: string;
  /** Build output directory: `.mcp-use/build`. */
  build: string;
  /**
   * Generated `.d.ts` artifacts directory — reserved for the typegen
   * escape-hatch command.
   */
  generated: string;
  /** Disposable dev/build scratch directory. */
  cache: string;
  /** Mutable runtime state directory. */
  state: string;
  /** Cloud linkage directory — reserved. */
  cloud: string;
  /** Build manifest: `<build>/manifest.json`. */
  buildManifest: string;
  /** Tunnel subdomain persistence: `<state>/tunnel.json`. */
  tunnel: string;
}

/**
 * Derive every workspace path for a project from its root. Pure — no
 * filesystem access.
 *
 * @param projectRoot - Absolute path to the project root.
 *
 * @example
 * ```ts
 * const paths = resolveWorkspacePaths(process.cwd());
 * console.log(paths.build); // <cwd>/.mcp-use/build
 * ```
 *
 * @internal
 */
export function resolveWorkspacePaths(projectRoot: string): WorkspacePaths {
  const workspace = join(projectRoot, WORKSPACE_DIR_NAME);
  const build = join(workspace, "build");
  return {
    projectRoot,
    workspace,
    build,
    generated: join(workspace, "generated"),
    cache: join(workspace, "cache"),
    state: join(workspace, "state"),
    cloud: join(workspace, "cloud"),
    buildManifest: join(build, BUILD_MANIFEST_NAME),
    tunnel: join(workspace, "state", "tunnel.json"),
  };
}
