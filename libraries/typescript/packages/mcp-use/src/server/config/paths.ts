/**
 * Derives the on-disk layout of the per-project `.mcp-use/` workspace — the
 * Next.js `.next` analog. Everything the SDK writes for a project (build
 * output, generated types, dev/build scratch, runtime state, cloud linkage)
 * lives under this single, gitignored directory so a checkout stays clean and
 * `rm -rf .mcp-use` is always safe.
 *
 * This module is PURE: it only derives path strings (no filesystem access), so
 * it is safe to call from sync server code and from the CLI. Use
 * {@link resolveWorkspace} for the common "load config + derive paths" one-shot.
 *
 * Layout (relative to the project root):
 *
 *   .mcp-use/
 *   ├─ build/        ← compiled server + views + public + manifest.json
 *   │                  (configurable via `outDir`; default `.mcp-use/build`)
 *   ├─ generated/    ← generated .d.ts (tool-registry, view-props)
 *   ├─ cache/        ← disposable dev/build scratch (vite entries, metadata)
 *   ├─ state/        ← mutable runtime state (sessions.json, tunnel.json)
 *   └─ cloud/        ← cloud linkage (link.json)
 *
 * The build output (`build/`) is the only part whose location is configurable
 * (`outDir`) and may even live outside `.mcp-use/`. It must contain NO mutable
 * runtime state — that lives under `state/` — so the build output stays
 * reproducible and disposable.
 *
 * NOTE: this is distinct from the GLOBAL store at `~/.mcp-use/` (CLI auth,
 * credentials, caches), which is a per-user directory, not a per-project one.
 */

import { pathHelpers } from "../utils/runtime.js";
import { loadConfig, type LoadConfigOptions } from "./loader.js";
import { DEFAULT_OUT_DIR, type ResolvedConfig } from "./schema.js";

/** Fixed name of the per-project workspace directory. */
export const WORKSPACE_DIR_NAME = ".mcp-use";

/** Basename of the build manifest written inside the build output directory. */
export const BUILD_MANIFEST_NAME = "manifest.json";

/** Every resolved path for a project's `.mcp-use/` workspace. */
export interface WorkspacePaths {
  /** The project root (directory containing `mcp-use.config.json`, or the cwd). */
  projectRoot: string;
  /** The `.mcp-use/` workspace directory. */
  workspace: string;
  /**
   * Build output directory (`outDir`, project-relative; default
   * `.mcp-use/build`). The only configurable path; may live outside `.mcp-use/`.
   */
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
 * Derive every workspace path for a project from its root and configured
 * `outDir`. Pure — no filesystem access.
 *
 * `outDir` defaults to {@link DEFAULT_OUT_DIR}, which is correct for the
 * fixed workspace dirs (`generated`/`cache`/`state`/`cloud`) regardless of a
 * project's real `outDir`. Callers that read the build-output fields
 * (`build`/`buildManifest`) MUST pass the project's actual `outDir` (e.g. from
 * a loaded config, or via {@link resolveWorkspace}).
 *
 * @param projectRoot absolute path to the project root
 * @param outDir build output directory, project-relative (default
 *   `.mcp-use/build`)
 */
export function resolveWorkspacePaths(
  projectRoot: string,
  outDir: string = DEFAULT_OUT_DIR
): WorkspacePaths {
  const workspace = join(projectRoot, WORKSPACE_DIR_NAME);
  const build = join(projectRoot, outDir);
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

/** Result of {@link resolveWorkspace}: the loaded config plus derived paths. */
export interface ResolvedWorkspace {
  /** The validated, fully-defaulted config. */
  config: ResolvedConfig;
  /** Absolute path to the loaded `mcp-use.config.json`, or `null` for defaults-only. */
  configPath: string | null;
  /** The project root. */
  projectRoot: string;
  /** Every derived workspace path. */
  paths: WorkspacePaths;
}

/**
 * Load the nearest `mcp-use.config.json` (or defaults) and derive the workspace paths
 * in one call. This is the common entry point for the CLI and for the server at
 * boot: a single read of config + the full path layout.
 *
 * @throws {import("./loader.js").ConfigError} if a config file is found but
 *   malformed.
 */
export async function resolveWorkspace(
  options: LoadConfigOptions = {}
): Promise<ResolvedWorkspace> {
  const { config, configPath, projectRoot } = await loadConfig(options);
  return {
    config,
    configPath,
    projectRoot,
    paths: resolveWorkspacePaths(projectRoot, config.outDir),
  };
}
