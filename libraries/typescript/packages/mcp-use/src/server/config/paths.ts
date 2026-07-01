/**
 * Derives the on-disk layout of the per-project `.mcp-use/` workspace — the
 * Next.js `.next` analog. Everything the SDK writes for a project (build
 * output, generated types, dev/build scratch, runtime state, cloud linkage)
 * lives under this single, gitignored directory so a checkout stays clean and
 * `rm -rf .mcp-use` is always safe.
 *
 * This module is PURE: it only derives path strings (no filesystem access), so
 * it is safe to call from sync server code and from the CLI.
 *
 * The layout is a fixed convention — there is no config file and no `outDir`
 * knob (project configuration lives on the `MCPServer` constructor; the
 * workspace layout is not configuration). Layout (relative to the project
 * root, which is the process cwd — the CLI always runs project commands from
 * the project directory):
 *
 *   .mcp-use/
 *   ├─ build/        ← compiled server + views + public + manifest.json
 *   ├─ generated/    ← generated .d.ts (tool-registry, view-props)
 *   ├─ cache/        ← disposable dev/build scratch (vite entries, metadata)
 *   ├─ state/        ← mutable runtime state (sessions.json, tunnel.json)
 *   └─ cloud/        ← cloud linkage (link.json)
 *
 * The build output (`build/`) must contain NO mutable runtime state — that
 * lives under `state/` — so the build output stays reproducible and
 * disposable.
 *
 * NOTE: this is distinct from the GLOBAL store at `~/.mcp-use/` (CLI auth,
 * credentials, caches), which is a per-user directory, not a per-project one.
 */

import { pathHelpers } from "../utils/runtime.js";

/** Fixed name of the per-project workspace directory. */
export const WORKSPACE_DIR_NAME = ".mcp-use";

/** Basename of the build manifest written inside the build output directory. */
export const BUILD_MANIFEST_NAME = "manifest.json";

/** Every resolved path for a project's `.mcp-use/` workspace. */
export interface WorkspacePaths {
  /** The project root (the directory containing `.mcp-use/`). */
  projectRoot: string;
  /** The `.mcp-use/` workspace directory. */
  workspace: string;
  /** Build output directory: `.mcp-use/build`. */
  build: string;
  /** Generated `.d.ts` artifacts directory. */
  generated: string;
  /** Disposable dev/build scratch directory. */
  cache: string;
  /** Mutable runtime state directory. */
  state: string;
  /** Cloud linkage directory. */
  cloud: string;

  // Convenience file paths --------------------------------------------------
  /** Build manifest: `<build>/manifest.json`. */
  buildManifest: string;
  /** Generated tool-registry types: `<generated>/tool-registry.d.ts`. */
  toolRegistry: string;
  /** Generated view-props types: `<generated>/view-props.d.ts`. */
  viewProps: string;
  /** Session store default: `<state>/sessions.json`. */
  sessions: string;
  /** Tunnel state: `<state>/tunnel.json`. */
  tunnel: string;
  /** Cloud project link: `<cloud>/link.json`. */
  cloudLink: string;
}

const join = pathHelpers.join;

/**
 * Derive every workspace path for a project from its root. Pure — no
 * filesystem access.
 *
 * @param projectRoot absolute path to the project root
 */
export function resolveWorkspacePaths(projectRoot: string): WorkspacePaths {
  const workspace = join(projectRoot, WORKSPACE_DIR_NAME);
  const build = join(workspace, "build");
  const generated = join(workspace, "generated");
  const cache = join(workspace, "cache");
  const state = join(workspace, "state");
  const cloud = join(workspace, "cloud");

  return {
    projectRoot,
    workspace,
    build,
    generated,
    cache,
    state,
    cloud,
    buildManifest: join(build, BUILD_MANIFEST_NAME),
    toolRegistry: join(generated, "tool-registry.d.ts"),
    viewProps: join(generated, "view-props.d.ts"),
    sessions: join(state, "sessions.json"),
    tunnel: join(state, "tunnel.json"),
    cloudLink: join(cloud, "link.json"),
  };
}
