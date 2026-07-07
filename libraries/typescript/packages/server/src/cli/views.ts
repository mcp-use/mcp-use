/**
 * View discovery and metadata extraction for `mcp-use build` / `mcp-use dev`.
 *
 * Views live under `resources/<name>/view.tsx` (VIEWS_SPEC.md § File-based views).
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  createServerModuleRunner,
  type DevEnvironment,
  type ViteDevServer,
} from "vite";

import type { ViewMetadata, ViewsManifest } from "../views/types.js";

/** Minimal Rollup chunk shape used to map client build output to manifest paths. */
export interface BuildOutputChunk {
  type: "chunk";
  fileName: string;
  facadeModuleId: string | null;
  name: string;
  imports: string[];
  viteMetadata?: { importedCss?: Set<string> };
}

/** Minimal Rollup bundle map from a client views build. */
export type BuildOutputBundle = Record<string, BuildOutputChunk | { type: string }>;

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
 * Evaluate each view module through the module runner and read its `metadata`
 * export. Only module scope runs — the component is never rendered.
 *
 * @param environment - Vite SSR dev environment (same runner machinery as the
 *   server entry).
 * @param views - Discovered views to evaluate.
 * @returns Metadata keyed by view name (missing export → `{}`).
 * @throws When a view module throws under evaluation, naming the view.
 *
 * @internal
 */
export async function extractViewMetadata(
  environment: DevEnvironment,
  views: DiscoveredView[]
): Promise<Record<string, ViewMetadata>> {
  if (views.length === 0) {
    return {};
  }

  const runner = createServerModuleRunner(environment, {
    hmr: false,
    sourcemapInterceptor: "node",
  });

  const metadataByView: Record<string, ViewMetadata> = {};
  try {
    for (const view of views) {
      try {
        const mod = (await runner.import(view.entryPath)) as Record<
          string,
          unknown
        >;
        const metadata = mod["metadata"];
        metadataByView[view.name] =
          metadata !== null &&
          typeof metadata === "object" &&
          !Array.isArray(metadata)
            ? (metadata as ViewMetadata)
            : {};
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to evaluate view "${view.name}" for metadata extraction: ${message}`
        );
      }
    }
  } finally {
    await runner.close();
  }
  return metadataByView;
}

/**
 * Build a dev-shaped views manifest (Vite URLs, `/@vite/client` script hook).
 *
 * @internal
 */
export function buildDevViewsManifest(
  views: DiscoveredView[],
  metadataByView: Record<string, ViewMetadata>
): ViewsManifest {
  const manifest: ViewsManifest = {};
  for (const view of views) {
    manifest[view.name] = {
      entry: devVirtualEntryPath(view.name),
      css: [],
      metadata: metadataByView[view.name] ?? {},
      scripts: ["/@vite/client"],
    };
  }
  return manifest;
}

/**
 * Collect CSS asset file names from an entry chunk and its static imports.
 */
function collectChunkCss(
  chunk: BuildOutputChunk,
  bundle: BuildOutputBundle,
  out: Set<string>
): void {
  const imported = chunk.viteMetadata?.importedCss;
  if (imported !== undefined) {
    for (const file of imported) {
      out.add(file);
    }
  }
  for (const importedFile of chunk.imports) {
    const importedChunk = bundle[importedFile];
    if (importedChunk?.type === "chunk") {
      collectChunkCss(importedChunk as BuildOutputChunk, bundle, out);
    }
  }
}

/**
 * Map a client build's Rollup output to production manifest entries.
 *
 * @param views - Built views (for ordering and names).
 * @param metadataByView - Metadata extracted before the client build.
 * @param bundle - Rollup output bundle from the client build.
 * @returns Manifest paths relative to `.mcp-use/build/`.
 * @throws When an entry chunk cannot be matched to a view.
 *
 * @internal
 */
export function buildProductionViewsManifest(
  views: DiscoveredView[],
  metadataByView: Record<string, ViewMetadata>,
  bundle: BuildOutputBundle
): ViewsManifest {
  const manifest: ViewsManifest = {};

  for (const view of views) {
    const resolvedId = `${VIRTUAL_VIEW_RESOLVED_PREFIX}${view.name}`;
    let entryChunk: BuildOutputChunk | undefined;

    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") {
        continue;
      }
      const chunk = output as BuildOutputChunk;
      if (
        chunk.facadeModuleId === resolvedId ||
        chunk.facadeModuleId === virtualViewId(view.name) ||
        chunk.name === view.name
      ) {
        entryChunk = chunk;
        break;
      }
    }

    if (entryChunk === undefined) {
      throw new Error(
        `Client build produced no entry chunk for view "${view.name}".`
      );
    }

    const cssFiles = new Set<string>();
    collectChunkCss(entryChunk, bundle, cssFiles);

    manifest[view.name] = {
      entry: `views/assets/${basename(entryChunk.fileName)}`,
      css: [...cssFiles].map((file) => `views/assets/${basename(file)}`),
      metadata: metadataByView[view.name] ?? {},
    };
  }

  return manifest;
}

/**
 * Create a temporary Vite dev server for build-time metadata extraction.
 *
 * @internal
 */
export async function createMetadataExtractionServer(
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
