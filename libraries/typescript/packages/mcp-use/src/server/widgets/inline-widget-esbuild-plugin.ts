/**
 * esbuild plugin for inline widget transform (production builds).
 *
 * Mirrors the Vite transform plugin but for the esbuild pipeline used
 * by `mcp-use build`. Detects JSX returns in server.tool() callbacks
 * and rewrites them to widget() calls.
 *
 * Since esbuild compiles JSX before this plugin runs, the compiled
 * output has the same `jsx(Component, { ... })` patterns that the
 * Vite transform handles.
 */

import type { InlineWidgetManifest } from "./inline-widget-transform.js";
import { transformInlineWidgets } from "./inline-widget-transform.js";

/**
 * Create an esbuild plugin for inline widget transformation.
 *
 * @param manifest - Shared manifest that accumulates discovered inline widgets
 * @param resolveImport - Optional function to resolve import paths
 * @returns esbuild Plugin object
 */
export function inlineWidgetEsbuildPlugin(
  manifest: InlineWidgetManifest,
  resolveImport?: (source: string, importer: string) => string | undefined
) {
  return {
    name: "mcp-use-inline-widget-transform",
    setup(build: any) {
      build.onLoad(
        { filter: /\.[tj]sx?$/, namespace: "file" },
        async (args: any) => {
          const fs = await import("node:fs");
          const path = await import("node:path");

          // Skip node_modules and .mcp-use
          if (args.path.includes("node_modules")) return undefined;
          if (args.path.includes(".mcp-use")) return undefined;

          const contents = fs.readFileSync(args.path, "utf8");

          // Quick bail: skip files without .tool( calls
          if (!contents.includes(".tool(") && !contents.includes(".tool (")) {
            return undefined;
          }

          const result = transformInlineWidgets(
            contents,
            resolveImport
              ? (source) => resolveImport(source, args.path)
              : (source) => {
                  // Default resolution: resolve relative to the file
                  if (source.startsWith(".")) {
                    const dir = path.dirname(args.path);
                    const resolved = path.resolve(dir, source);
                    // Try common extensions
                    for (const ext of [".tsx", ".ts", ".jsx", ".js", ""]) {
                      const full = resolved + ext;
                      try {
                        fs.statSync(full);
                        return full;
                      } catch {
                        // Try next
                      }
                    }
                    // Try as directory with index
                    for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
                      const full = path.join(resolved, "index" + ext);
                      try {
                        fs.statSync(full);
                        return full;
                      } catch {
                        // Try next
                      }
                    }
                  }
                  return source;
                }
          );

          if (!result.changed) return undefined;

          for (const entry of result.entries) {
            if (entry.toolName) {
              manifest.set(entry.toolName, entry);
            }
          }

          return {
            contents: result.code,
            loader: args.path.endsWith(".tsx")
              ? "tsx"
              : args.path.endsWith(".ts")
                ? "ts"
                : args.path.endsWith(".jsx")
                  ? "jsx"
                  : "js",
          };
        }
      );
    },
  };
}
