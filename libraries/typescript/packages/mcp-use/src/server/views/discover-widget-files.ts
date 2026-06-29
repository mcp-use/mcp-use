/**
 * Discover file-based widgets under the project's resources directory.
 * Used to skip Vite/widget toolchain for tool-only servers (MCP-2542/2543).
 */

import { getCwd, pathHelpers } from "../utils/runtime.js";
import { isDeno, isProductionMode } from "../utils/index.js";
import { fsHelpers } from "../utils/runtime.js";

type WidgetFileEntry = { name: string; path: string };
type DenoDirEntry = { name: string; isFile: boolean; isDirectory: boolean };
type DenoGlobal = typeof globalThis & {
  Deno: { readDir(path: string): AsyncIterable<DenoDirEntry> };
};

/**
 * Scan resourcesDir for `.tsx`/`.ts` widget files and folders containing `widget.tsx`.
 */
export async function discoverWidgetFileEntries(options?: {
  resourcesDir?: string;
}): Promise<WidgetFileEntry[]> {
  const resourcesDir =
    options?.resourcesDir || process.env.MCP_USE_WIDGETS_DIR || "resources";
  const srcDir = pathHelpers.join(getCwd(), resourcesDir);

  if (!(await fsHelpers.existsSync(srcDir))) {
    return [];
  }

  const entries: WidgetFileEntry[] = [];

  try {
    if (isDeno) {
      for await (const entry of (globalThis as DenoGlobal).Deno.readDir(
        srcDir
      )) {
        if (entry.name.startsWith("._") || entry.name.startsWith(".DS_Store")) {
          continue;
        }
        if (
          entry.isFile &&
          (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))
        ) {
          entries.push({
            name: entry.name.replace(/\.tsx?$/, ""),
            path: pathHelpers.join(srcDir, entry.name),
          });
        } else if (entry.isDirectory) {
          const widgetPath = pathHelpers.join(srcDir, entry.name, "widget.tsx");
          if (await fsHelpers.existsSync(widgetPath)) {
            entries.push({ name: entry.name, path: widgetPath });
          }
        }
      }
      return entries;
    }

    const { promises: fs } = await import("node:fs");
    const files = await fs.readdir(srcDir, { withFileTypes: true });
    for (const dirent of files) {
      if (dirent.name.startsWith("._") || dirent.name.startsWith(".DS_Store")) {
        continue;
      }

      if (
        dirent.isFile() &&
        (dirent.name.endsWith(".tsx") || dirent.name.endsWith(".ts"))
      ) {
        entries.push({
          name: dirent.name.replace(/\.tsx?$/, ""),
          path: pathHelpers.join(srcDir, dirent.name),
        });
      } else if (dirent.isDirectory()) {
        const widgetPath = pathHelpers.join(srcDir, dirent.name, "widget.tsx");
        try {
          await fs.access(widgetPath);
          entries.push({ name: dirent.name, path: widgetPath });
        } catch {
          // widget.tsx doesn't exist in this folder, skip it
        }
      }
    }
  } catch {
    return [];
  }

  return entries;
}

async function hasBuiltWidgetsInManifest(): Promise<boolean> {
  const manifestPaths = [
    pathHelpers.join(getCwd(), ".mcp-use", "build", "manifest.json"),
    pathHelpers.join(getCwd(), "dist", "mcp-use.json"),
  ];
  for (const manifestPath of manifestPaths) {
    try {
      const manifestContent = await fsHelpers.readFileSync(
        manifestPath,
        "utf8"
      );
      const manifest = JSON.parse(manifestContent);
      if (
        manifest.widgets &&
        typeof manifest.widgets === "object" &&
        !Array.isArray(manifest.widgets)
      ) {
        return Object.keys(manifest.widgets).length > 0;
      }
      if (Array.isArray(manifest.widgets)) {
        return manifest.widgets.length > 0;
      }
      if (
        manifest.inlineWidgetTools &&
        typeof manifest.inlineWidgetTools === "object" &&
        !Array.isArray(manifest.inlineWidgetTools)
      ) {
        return Object.keys(manifest.inlineWidgetTools).length > 0;
      }
    } catch {
      // Try the next manifest path, then fall through to directory listing.
    }
  }

  const widgetsDir = pathHelpers.join(
    isDeno ? "." : getCwd(),
    ".mcp-use",
    "build",
    "views",
    "widgets"
  );
  try {
    const allEntries = await fsHelpers.readdirSync(widgetsDir);
    for (const name of allEntries) {
      const indexPath = pathHelpers.join(widgetsDir, name, "index.html");
      if (await fsHelpers.existsSync(indexPath)) {
        return true;
      }
    }
  } catch {
    // No built widgets
  }

  return false;
}

/**
 * Whether mountViews should run (file-based dev widgets or production build output).
 * Programmatic `server.uiResource()` does not require this — it registers inline HTML directly.
 */
export async function shouldMountWidgets(options?: {
  resourcesDir?: string;
}): Promise<boolean> {
  const fileEntries = await discoverWidgetFileEntries(options);
  if (fileEntries.length > 0) {
    return true;
  }

  if (isProductionMode() || isDeno) {
    return hasBuiltWidgetsInManifest();
  }

  return false;
}
