/**
 * View discovery for `mcp-use build` / `mcp-use dev`.
 *
 * Views live under `views/<name>/view.tsx` (VIEWS_SPEC.md § File-based views).
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { ViteDevServer } from "vite";

import type { ViewsManifest } from "../views/types.js";
import {
  nextStandaloneAliases,
  nextStandaloneCompatPlugin,
  nextStandaloneSsrOptions,
} from "./next-compat.js";
import { legacyWidgetMetadataPlugin } from "./legacy-widget-metadata.js";

/** Author-facing view source directory at the project root. */
export const VIEWS_SOURCE_DIR = "views" as const;

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
  /** Whether this entry uses the deprecated `resources/<name>/widget.tsx` layout. */
  legacy?: boolean;
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
  override?: string,
  options?: { includeLegacy?: boolean }
): DiscoveredView[] {
  const viewsDir = resolveViewsDir(cwd, override);
  const resourcesDir =
    override === undefined
      ? resolve(cwd, "resources")
      : resolve(dirname(viewsDir), "resources");
  const byName = new Map<string, DiscoveredView>();
  scanViewDirectory(viewsDir, "view.tsx", false, byName);
  if (options?.includeLegacy === true) {
    scanViewDirectory(resourcesDir, "widget.tsx", true, byName);
  }
  const views = [...byName.values()];
  views.sort((a, b) => a.name.localeCompare(b.name));
  return views;
}

function scanViewDirectory(
  directory: string,
  filename: string,
  legacy: boolean,
  views: Map<string, DiscoveredView>
): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(directory, entry.name, filename);
    if (!existsSync(entryPath)) continue;
    if (legacy && views.has(entry.name)) {
      console.warn(
        `[mcp-use] Both native and legacy view entries exist for "${entry.name}"; using views/${entry.name}/view.tsx.`
      );
      continue;
    }
    views.set(entry.name, {
      name: entry.name,
      entryPath,
      ...(legacy && { legacy: true }),
    });
  }
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
export function isViewPath(
  file: string,
  cwd: string,
  override?: string
): boolean {
  const viewsDir = resolveViewsDir(cwd, override);
  const resourcesDir =
    override === undefined
      ? resolve(cwd, "resources")
      : resolve(dirname(viewsDir), "resources");
  return (
    file === viewsDir ||
    file.startsWith(`${viewsDir}/`) ||
    file === resourcesDir ||
    file.startsWith(`${resourcesDir}/`)
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
  const resourcesDir =
    override === undefined
      ? resolve(cwd, "resources")
      : resolve(dirname(viewsDir), "resources");
  const viewsRel = file.startsWith(`${viewsDir}/`)
    ? file.slice(viewsDir.length + 1)
    : file;
  const resourcesRel = file.startsWith(`${resourcesDir}/`)
    ? file.slice(resourcesDir.length + 1)
    : file;
  return (
    /^[^/]+\/view\.tsx$/.test(viewsRel) ||
    /^[^/]+\/widget\.tsx$/.test(resourcesRel)
  );
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
    plugins: [
      nextStandaloneCompatPlugin(cwd),
      legacyWidgetMetadataPlugin(),
      react(),
    ],
    server: { middlewareMode: true, hmr: false },
    ssr: {
      ...nextStandaloneSsrOptions(cwd),
    },
  });
}
