/**
 * View discovery for `mcp-use build` / `mcp-use dev`.
 *
 * Views live under `resources/<name>/view.tsx` (VIEWS_SPEC.md § File-based views).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ViteDevServer } from "vite";

import type { ViewsManifest } from "../views/types.js";

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
  /** View directory name (the `resources/<name>` segment). */
  name: string;
  /** Absolute path to `resources/<name>/view.tsx`. */
  entryPath: string;
}

/**
 * Scan `resources/<name>/view.tsx` under the project root.
 *
 * A missing or empty `resources/` directory yields an empty list — tool-only
 * projects keep byte-identical CLI behavior.
 *
 * @param cwd - Absolute project root.
 * @returns Discovered views sorted by name.
 *
 * @internal
 */
export function discoverViews(cwd: string): DiscoveredView[] {
  const resourcesDir = join(cwd, "resources");
  if (!existsSync(resourcesDir)) {
    return [];
  }

  const views: DiscoveredView[] = [];
  for (const entry of readdirSync(resourcesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = join(resourcesDir, entry.name, "view.tsx");
    if (existsSync(entryPath)) {
      views.push({ name: entry.name, entryPath });
    }
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
export function devVirtualEntryPath(name: string): string {
  return `/@id/__x00__${VIRTUAL_VIEW_PREFIX}${name}`;
}

/**
 * Whether a filesystem path is a view component file or lives under a view dir.
 *
 * @internal
 */
export function isViewPath(file: string, cwd: string): boolean {
  const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
  return /^resources\/[^/]+\//.test(rel) || /^resources\/[^/]+\/view\.tsx$/.test(rel);
}

/**
 * Whether a path is a view's `view.tsx` entry.
 *
 * @internal
 */
export function isViewEntryPath(file: string, cwd: string): boolean {
  const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
  return /^resources\/[^/]+\/view\.tsx$/.test(rel);
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
    envFile: false,
    logLevel: "warn",
    cacheDir,
    server: { middlewareMode: true, hmr: false },
    ssr: { external: true },
  });
}
