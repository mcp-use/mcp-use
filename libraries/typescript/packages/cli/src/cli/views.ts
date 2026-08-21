/**
 * View discovery for `mcp-use build` / `mcp-use dev`.
 *
 * Views live under `views/<name>/view.tsx`.
 */

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ViteDevServer } from "vite";

import type { ViewsManifest } from "../views/types.js";
import {
  nextStandaloneAliases,
  nextStandaloneCompatPlugin,
  nextStandaloneSsrOptions,
} from "./next-compat.js";

/** Author-facing view source directory at the project root. */
const VIEWS_SOURCE_DIR = "views" as const;

/** Prefix for per-view virtual entry modules (`virtual:mcp-use/views/<name>`). */
export const VIRTUAL_VIEW_PREFIX = "virtual:mcp-use/views/";

/** Resolved virtual id prefix (Rollup null-prefixed module id). */
export const VIRTUAL_VIEW_RESOLVED_PREFIX = `\0${VIRTUAL_VIEW_PREFIX}`;

/**
 * One discovered view directory.
 *
 * @internal
 */
export interface DiscoveredView {
  /** View directory name (the `views/<name>` segment). */
  name: string;
  /** Absolute path to `views/<name>/view.tsx`. */
  entryPath: string;
}

/**
 * Scan `views/<name>/view.tsx` under the project root.
 *
 * A missing or empty `views/` directory yields an empty list — tool-only
 * projects keep byte-identical CLI behavior.
 *
 * @param cwd - Absolute project root.
 * @returns Discovered views sorted by name.
 *
 * @internal
 */
export function resolveViewsDir(cwd: string, override?: string): string {
  const directory = override ?? VIEWS_SOURCE_DIR;
  return isAbsolute(directory) ? directory : resolve(cwd, directory);
}

/**
 * Scan `views/<name>/view.tsx` under the project root.
 *
 * A missing or empty views directory yields an empty list — tool-only
 * projects keep byte-identical CLI behavior.
 *
 * @param cwd - Absolute project root.
 * @param override - Optional views directory, absolute or relative to `cwd`.
 * @returns Discovered views sorted by name.
 *
 * @internal
 */
export function discoverViews(
  cwd: string,
  override?: string
): DiscoveredView[] {
  const viewsDir = resolveViewsDir(cwd, override);
  if (!existsSync(viewsDir)) return [];
  const views: DiscoveredView[] = [];
  for (const entry of readdirSync(viewsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(viewsDir, entry.name, "view.tsx");
    if (!existsSync(entryPath)) continue;
    views.push({ name: entry.name, entryPath });
  }
  views.sort((a, b) => a.name.localeCompare(b.name));
  return views;
}

/**
 * Virtual module id for a view entry (`virtual:mcp-use/views/<name>`).
 *
 * @param name - View directory name.
 *
 * @internal
 */
export function virtualViewId(name: string): string {
  return `${VIRTUAL_VIEW_PREFIX}${name}`;
}

/**
 * Dev URL path Vite serves a resolved virtual module at (browser-loadable).
 *
 * @param name - View directory name.
 *
 * @internal
 */
function devVirtualEntryPath(name: string): string {
  return `/@id/__x00__${VIRTUAL_VIEW_PREFIX}${name}`;
}

/**
 * Whether a filesystem path is a view component file or lives under a view dir.
 *
 * @internal
 */
export function isViewPath(
  file: string,
  cwd: string,
  override?: string
): boolean {
  const viewsDir = resolveViewsDir(cwd, override);
  const viewRelativePath = relative(viewsDir, resolve(file));
  return (
    viewRelativePath === "" ||
    (!viewRelativePath.startsWith("..") && !isAbsolute(viewRelativePath))
  );
}

/**
 * Whether a path is a view's `view.tsx` entry.
 *
 * @internal
 */
export function isViewEntryPath(
  file: string,
  cwd: string,
  override?: string
): boolean {
  const viewsDir = resolveViewsDir(cwd, override);
  const viewsRel = relative(viewsDir, resolve(file)).split(sep).join("/");
  return /^[^/]+\/view\.tsx$/.test(viewsRel);
}

/**
 * Build a dev-shaped views manifest (Vite URLs, `/@vite/client` script hook).
 *
 * @internal
 */
export function buildDevViewsManifest(views: DiscoveredView[]): ViewsManifest {
  const manifest: ViewsManifest = {};
  for (const view of views) {
    manifest[view.name] = {
      kind: "external",
      entry: devVirtualEntryPath(view.name),
      css: [],
      scripts: ["/@vite/client"],
    };
  }
  return manifest;
}

/**
 * Create a temporary Vite dev server for build-time binding validation.
 *
 * @internal
 */
export async function createBindingValidationServer(
  cwd: string,
  cacheDir: string,
  configFile: string | false
): Promise<ViteDevServer> {
  const { createServer } = await import("vite");
  return createServer({
    root: cwd,
    configFile,
    envDir: false,
    logLevel: "warn",
    cacheDir,
    resolve: {
      tsconfigPaths: true,
      alias: nextStandaloneAliases(cwd),
    },
    oxc: { jsx: { runtime: "automatic" } },
    // No React plugin here: this server only runs when the project has no
    // views, so there is no JSX to transform, and loading it pulls react and
    // the jsx runtimes into optimizeDeps where they cannot resolve.
    plugins: [nextStandaloneCompatPlugin(cwd)],
    server: { middlewareMode: true, hmr: false, ws: false },
    ssr: {
      ...nextStandaloneSsrOptions(cwd),
    },
  });
}
