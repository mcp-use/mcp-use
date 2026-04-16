/**
 * Inline Widget Bundler
 *
 * Orchestrates the bundling of inline widget components discovered by the
 * transform plugin. Handles:
 * - Creating temp files (entry.tsx, index.html, styles.css) for each widget
 * - Manifest diffing on HMR (detect added/removed/changed widgets)
 * - Reading component .config for CSP/permissions
 * - Registering widgets as UI resources
 *
 * Used by both mountWidgetsDev() and buildWidgets() in the CLI.
 */

import type { InlineWidgetManifestEntry } from "./inline-widget-middleware.js";
import type { InlineWidgetManifest } from "./inline-widget-transform.js";
import {
  generateInlineWidgetFiles,
} from "./inline-widget-entry-gen.js";
import type { RegisterWidgetCallback, RemoveWidgetToolCallback } from "./widget-types.js";

const INLINE_WIDGETS_DIR = "inline-widgets";

/**
 * Diff two manifests and return added, removed, and changed entries.
 */
export function diffManifests(
  oldManifest: InlineWidgetManifest,
  newManifest: InlineWidgetManifest
): {
  added: InlineWidgetManifestEntry[];
  removed: InlineWidgetManifestEntry[];
  changed: InlineWidgetManifestEntry[];
} {
  const added: InlineWidgetManifestEntry[] = [];
  const removed: InlineWidgetManifestEntry[] = [];
  const changed: InlineWidgetManifestEntry[] = [];

  for (const [toolName, entry] of newManifest) {
    const old = oldManifest.get(toolName);
    if (!old) {
      added.push(entry);
    } else if (
      old.componentPath !== entry.componentPath ||
      old.widgetName !== entry.widgetName ||
      old.invoking !== entry.invoking ||
      old.invoked !== entry.invoked
    ) {
      changed.push(entry);
    }
  }

  for (const [toolName, entry] of oldManifest) {
    if (!newManifest.has(toolName)) {
      removed.push(entry);
    }
  }

  return { added, removed, changed };
}

/**
 * Create temp files for an inline widget in the .mcp-use directory.
 *
 * @param entry - Widget manifest entry
 * @param tempBaseDir - Base temp directory (.mcp-use)
 * @param cwd - Current working directory
 * @param baseUrl - Vite base URL for dev server
 * @param favicon - Optional favicon path
 */
export async function createInlineWidgetTempFiles(
  entry: InlineWidgetManifestEntry,
  tempBaseDir: string,
  cwd: string,
  baseUrl: string,
  favicon?: string
): Promise<void> {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");

  const widgetDir = path.join(tempBaseDir, INLINE_WIDGETS_DIR, entry.widgetName);
  await fs.mkdir(widgetDir, { recursive: true });

  const relativeComponentPath = path.relative(widgetDir, entry.componentPath);
  const componentDir = path.dirname(entry.componentPath);
  const relativeComponentDir = path.relative(widgetDir, componentDir);
  const mcpUsePath = path.join(cwd, "node_modules", "mcp-use");
  const relativeMcpUsePath = path.relative(widgetDir, mcpUsePath);

  const files = generateInlineWidgetFiles(
    entry,
    relativeComponentPath,
    relativeComponentDir,
    relativeMcpUsePath,
    baseUrl,
    favicon
  );

  await fs.writeFile(path.join(widgetDir, "entry.tsx"), files.entryTsx, "utf8");
  await fs.writeFile(path.join(widgetDir, "index.html"), files.indexHtml, "utf8");
  await fs.writeFile(path.join(widgetDir, "styles.css"), files.stylesCss, "utf8");
}

/**
 * Remove temp files for an inline widget.
 */
export async function removeInlineWidgetTempFiles(
  widgetName: string,
  tempBaseDir: string
): Promise<void> {
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");

  const widgetDir = path.join(tempBaseDir, INLINE_WIDGETS_DIR, widgetName);
  try {
    await fs.rm(widgetDir, { recursive: true, force: true });
  } catch {
    // Directory may not exist
  }
}

/**
 * Read a component's .config static property via Vite SSR module loading.
 *
 * @param viteServer - Vite dev server instance
 * @param componentPath - Absolute path to the component file
 * @returns The config object or undefined
 */
export async function readComponentConfig(
  viteServer: any,
  componentPath: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const mod = await viteServer.ssrLoadModule(componentPath);
    const component = mod.default || mod;
    return component?.config as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Merge widget configs with precedence: defaults <- component .config <- JSX _ props.
 */
export function mergeWidgetConfigs(
  componentConfig?: Record<string, unknown>,
  jsxConfig?: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  if (componentConfig) {
    Object.assign(merged, componentConfig);
    if (componentConfig.csp && typeof componentConfig.csp === "object") {
      merged.csp = { ...(componentConfig.csp as Record<string, unknown>) };
    }
  }

  if (jsxConfig) {
    for (const [key, value] of Object.entries(jsxConfig)) {
      if (key === "csp" && typeof value === "object" && value !== null) {
        merged.csp = {
          ...((merged.csp as Record<string, unknown>) || {}),
          ...(value as Record<string, unknown>),
        };
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}

/**
 * Process an inline widget manifest and create all necessary files + registrations.
 *
 * @param manifest - The inline widget manifest
 * @param viteServer - Vite dev server (for SSR loading component config)
 * @param tempBaseDir - Base temp directory (.mcp-use)
 * @param cwd - Current working directory
 * @param baseUrl - Vite base URL
 * @param serverConfig - Server config for widget registration
 * @param registerWidget - Callback to register widget
 * @param favicon - Optional favicon path
 */
export async function processInlineWidgetManifest(
  manifest: InlineWidgetManifest,
  viteServer: any,
  tempBaseDir: string,
  cwd: string,
  baseUrl: string,
  serverConfig: any,
  registerWidget: RegisterWidgetCallback,
  favicon?: string
): Promise<void> {
  const { registerWidgetFromTemplate } = await import("./widget-helpers.js");
  const path = await import("node:path");

  for (const [_toolName, entry] of manifest) {
    await createInlineWidgetTempFiles(
      entry,
      tempBaseDir,
      cwd,
      baseUrl,
      favicon
    );

    const componentConfig = await readComponentConfig(
      viteServer,
      entry.componentPath
    );

    const htmlPath = path.join(
      tempBaseDir,
      INLINE_WIDGETS_DIR,
      entry.widgetName,
      "index.html"
    );

    const metadata: Record<string, unknown> = {
      description: `Inline widget: ${entry.widgetName}`,
      ...(componentConfig || {}),
    };

    await registerWidgetFromTemplate(
      entry.widgetName,
      htmlPath,
      metadata,
      serverConfig,
      registerWidget,
      true // isDev
    );
  }
}

/**
 * Handle HMR manifest diff: create/remove/update inline widget files and registrations.
 */
export async function handleManifestDiff(
  oldManifest: InlineWidgetManifest,
  newManifest: InlineWidgetManifest,
  viteServer: any,
  tempBaseDir: string,
  cwd: string,
  baseUrl: string,
  serverConfig: any,
  registerWidget: RegisterWidgetCallback,
  removeWidgetTool: RemoveWidgetToolCallback,
  favicon?: string
): Promise<{ added: number; removed: number; changed: number }> {
  const { registerWidgetFromTemplate } = await import("./widget-helpers.js");
  const path = await import("node:path");

  const diff = diffManifests(oldManifest, newManifest);

  for (const entry of diff.removed) {
    await removeInlineWidgetTempFiles(entry.widgetName, tempBaseDir);
    removeWidgetTool(entry.widgetName);
  }

  for (const entry of [...diff.added, ...diff.changed]) {
    await createInlineWidgetTempFiles(
      entry,
      tempBaseDir,
      cwd,
      baseUrl,
      favicon
    );

    const componentConfig = await readComponentConfig(
      viteServer,
      entry.componentPath
    );

    const htmlPath = path.join(
      tempBaseDir,
      INLINE_WIDGETS_DIR,
      entry.widgetName,
      "index.html"
    );

    const metadata: Record<string, unknown> = {
      description: `Inline widget: ${entry.widgetName}`,
      ...(componentConfig || {}),
    };

    await registerWidgetFromTemplate(
      entry.widgetName,
      htmlPath,
      metadata,
      serverConfig,
      registerWidget,
      true // isDev
    );

    // Add component directory to Vite watcher
    if (viteServer.watcher) {
      const componentDir = path.dirname(entry.componentPath);
      viteServer.watcher.add(componentDir);
    }
  }

  return {
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
  };
}

/**
 * Serialize inline widget manifest for the production build manifest.
 *
 * @param manifest - In-memory manifest
 * @returns JSON-serializable object for dist/mcp-use.json
 */
export function serializeManifestForBuild(
  manifest: InlineWidgetManifest
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [toolName, entry] of manifest) {
    result[toolName] = {
      widgetName: entry.widgetName,
      componentPath: entry.componentPath,
      invoking: entry.invoking,
      invoked: entry.invoked,
      visibility: entry.visibility,
      fileParams: entry.fileParams,
    };
  }
  return result;
}

/**
 * Deserialize inline widget manifest from the production build manifest.
 *
 * @param data - Serialized data from dist/mcp-use.json inlineWidgetTools
 * @returns In-memory manifest
 */
export function deserializeManifestFromBuild(
  data: Record<string, any>
): InlineWidgetManifest {
  const manifest: InlineWidgetManifest = new Map();
  for (const [toolName, entry] of Object.entries(data)) {
    manifest.set(toolName, {
      toolName,
      widgetName: entry.widgetName,
      componentPath: entry.componentPath || "",
      invoking: entry.invoking,
      invoked: entry.invoked,
      visibility: entry.visibility,
      fileParams: entry.fileParams,
    });
  }
  return manifest;
}
