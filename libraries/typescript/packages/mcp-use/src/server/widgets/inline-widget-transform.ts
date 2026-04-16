/**
 * Inline Widget Transform Plugin (Vite / esbuild)
 *
 * Detects JSX returns in `server.tool()` callbacks, extracts component
 * references and static metadata, rewrites JSX to `widget()` calls,
 * and emits a manifest for widget bundling.
 *
 * After the React plugin compiles JSX, this plugin sees compiled calls like:
 *   `jsx(MyComponent, { query, results, _output: text(...), _invoking: "..." })`
 *
 * It transforms them to:
 *   `widget({ props: { query, results }, output: text(...) })`
 *
 * And records the component for separate bundling as a widget resource.
 */

import type { InlineWidgetManifestEntry } from "./inline-widget-middleware.js";

/**
 * Manifest of inline widgets discovered during transform.
 * Maps tool names to their widget entries.
 */
export type InlineWidgetManifest = Map<string, InlineWidgetManifestEntry>;

/**
 * Result of a single source file transform.
 */
export interface TransformResult {
  /** Transformed source code. */
  code: string;
  /** Discovered inline widget entries. */
  entries: InlineWidgetManifestEntry[];
  /** Whether the source was modified. */
  changed: boolean;
}

/**
 * Regex patterns for detecting compiled JSX calls.
 *
 * After @vitejs/plugin-react or esbuild compiles JSX:
 * - `<MyComponent foo={bar} />` becomes `jsx(MyComponent, { foo: bar })`
 * - Or `_jsx(MyComponent, { ... })`, `jsxs(...)`, `_jsxs(...)`,
 *   `jsxDEV(...)`, `React.createElement(MyComponent, { ... })`
 */
const JSX_CALL_RE =
  /(?:_?jsxs?|_?jsxDEV|React\.createElement)\s*\(\s*([A-Z]\w*)\s*,\s*(\{)/g;

/**
 * Regex to find import declarations and map identifiers to sources.
 * Matches: `import Foo from "./bar"` or `import { Foo } from "./bar"`
 */
const IMPORT_RE =
  /import\s+(?:(\w+)|(?:\{[^}]*\b(\w+)\b[^}]*\}))\s+from\s+["']([^"']+)["']/g;

/**
 * Regex to detect if we're inside a `server.tool(` or `.tool(` callback.
 * Matches `.tool(` preceded by optional identifier.
 */
const TOOL_CALL_RE = /\.tool\s*\(/g;

/**
 * Convert PascalCase component name to kebab-case widget name.
 */
function toWidgetName(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Extract a string literal value from a JS expression.
 * Returns undefined if not a simple string literal.
 */
function extractStringLiteral(expr: string): string | undefined {
  const match = expr.match(/^["']([^"']*)["']$/);
  return match ? match[1] : undefined;
}

/**
 * Find the matching closing brace for an opening brace at position `start`.
 */
function findMatchingBrace(code: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  let inString: string | null = null;
  let escaped = false;

  while (i < code.length && depth > 0) {
    const ch = code[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      i++;
      continue;
    }

    if (inString) {
      if (ch === inString) inString = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    }
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

/**
 * Parse a JS object literal's top-level key-value pairs.
 * Returns a map of key -> raw expression string.
 * Handles nested objects/arrays/functions by brace matching.
 */
function parseObjectEntries(
  objSource: string
): Map<string, string> {
  const entries = new Map<string, string>();
  let i = 0;
  const src = objSource.trim();
  if (src[0] !== "{") return entries;

  i = 1; // skip opening brace
  while (i < src.length - 1) {
    // Skip whitespace and commas
    while (i < src.length && /[\s,]/.test(src[i])) i++;
    if (i >= src.length - 1) break;

    // Parse key
    let key: string;
    const keyMatch = src.slice(i).match(/^(?:["'](\w+)["']|(\w+))\s*:/);
    if (!keyMatch) break;
    key = keyMatch[1] || keyMatch[2];
    i += keyMatch[0].length;

    // Skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;

    // Parse value (find end by matching braces/brackets/strings)
    const valueStart = i;
    let depth = 0;
    let inStr: string | null = null;
    let esc = false;

    while (i < src.length) {
      const ch = src[i];
      if (esc) {
        esc = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        i++;
        continue;
      }
      if (inStr) {
        if (ch === inStr) inStr = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
      } else if (ch === "{" || ch === "[" || ch === "(") {
        depth++;
      } else if (ch === "}" || ch === "]" || ch === ")") {
        if (depth === 0) break;
        depth--;
      } else if (ch === "," && depth === 0) {
        break;
      }
      i++;
    }

    entries.set(key, src.slice(valueStart, i).trim());
  }

  return entries;
}

/**
 * Transform a single source file, detecting inline widget JSX returns
 * and rewriting them to `widget()` calls.
 *
 * @param code - The compiled JS source (after JSX transform)
 * @param importMap - Map of import identifiers to source paths
 * @param resolveImport - Optional function to resolve import paths to absolute paths
 * @returns Transform result with modified code and discovered entries
 */
export function transformInlineWidgets(
  code: string,
  resolveImport?: (source: string) => string | undefined
): TransformResult {
  const entries: InlineWidgetManifestEntry[] = [];

  // Build import map: identifier -> source path
  const importMap = new Map<string, string>();
  let importMatch;
  const importRe = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
  while ((importMatch = importRe.exec(code)) !== null) {
    const defaultImport = importMatch[1];
    const namedImport = importMatch[2];
    const source = importMatch[3];
    if (defaultImport) importMap.set(defaultImport, source);
    if (namedImport) importMap.set(namedImport, source);
  }

  // Check if file has any .tool( calls (quick bail-out)
  if (!code.includes(".tool(") && !code.includes(".tool (")) {
    return { code, entries, changed: false };
  }

  let transformed = code;
  let offset = 0;
  const jsxRe = new RegExp(JSX_CALL_RE.source, JSX_CALL_RE.flags);
  let match;
  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
    entry: InlineWidgetManifestEntry;
  }> = [];

  while ((match = jsxRe.exec(code)) !== null) {
    const componentName = match[1];
    const propsObjStart = match.index + match[0].length - 1; // position of '{'

    // Skip non-imported components (HTML elements start lowercase, already filtered by regex)
    const importSource = importMap.get(componentName);
    if (!importSource) continue;

    // Skip React/library imports that aren't user components
    if (
      importSource === "react" ||
      importSource.startsWith("react/") ||
      importSource === "mcp-use" ||
      importSource.startsWith("mcp-use/")
    )
      continue;

    // Find the full props object
    const propsObjEnd = findMatchingBrace(code, propsObjStart);
    if (propsObjEnd === -1) continue;

    // Find the closing paren of the jsx() call
    const callEnd = code.indexOf(")", propsObjEnd);
    if (callEnd === -1) continue;

    const propsSource = code.slice(propsObjStart, propsObjEnd + 1);

    // Parse props to separate _ prefixed (metadata) from regular (component data)
    const propEntries = parseObjectEntries(propsSource);
    const dataProps: string[] = [];
    const metaFields: Record<string, string> = {};

    for (const [key, value] of propEntries) {
      if (key.startsWith("_")) {
        metaFields[key] = value;
      } else if (key !== "children") {
        dataProps.push(`${key}: ${value}`);
      }
    }

    // Build the widget() call
    const parts: string[] = [];
    if (dataProps.length > 0) {
      parts.push(`props: { ${dataProps.join(", ")} }`);
    }
    if (metaFields["_output"]) {
      parts.push(`output: ${metaFields["_output"]}`);
    }
    if (metaFields["_meta"]) {
      parts.push(`metadata: ${metaFields["_meta"]}`);
    }

    const widgetCall = `widget({ ${parts.join(", ")} })`;

    // Extract static metadata for the manifest
    const widgetName = toWidgetName(componentName);
    const invoking = metaFields["_invoking"]
      ? extractStringLiteral(metaFields["_invoking"])
      : undefined;
    const invoked = metaFields["_invoked"]
      ? extractStringLiteral(metaFields["_invoked"])
      : undefined;

    const resolvedPath = resolveImport
      ? resolveImport(importSource)
      : importSource;

    const entry: InlineWidgetManifestEntry = {
      toolName: "", // Will be resolved by the caller (needs .tool() context)
      widgetName,
      componentPath: resolvedPath || importSource,
      invoking,
      invoked,
    };

    // Parse _visibility if present
    if (metaFields["_visibility"]) {
      try {
        const visStr = metaFields["_visibility"];
        const visMatch = visStr.match(/\[([^\]]*)\]/);
        if (visMatch) {
          entry.visibility = visMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/["']/g, ""))
            .filter((s): s is "model" | "app" => s === "model" || s === "app");
        }
      } catch {
        // Not parseable statically, skip
      }
    }

    // Parse _fileParams if present
    if (metaFields["_fileParams"]) {
      try {
        const fpStr = metaFields["_fileParams"];
        const fpMatch = fpStr.match(/\[([^\]]*)\]/);
        if (fpMatch) {
          entry.fileParams = fpMatch[1]
            .split(",")
            .map((s) => s.trim().replace(/["']/g, ""))
            .filter(Boolean);
        }
      } catch {
        // Not parseable statically, skip
      }
    }

    replacements.push({
      start: match.index,
      end: callEnd + 1,
      replacement: widgetCall,
      entry,
    });
  }

  if (replacements.length === 0) {
    return { code, entries, changed: false };
  }

  // Apply replacements in reverse order to preserve positions
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    transformed =
      transformed.slice(0, r.start + offset) +
      r.replacement +
      transformed.slice(r.end + offset);
    offset += r.replacement.length - (r.end - r.start);
    entries.unshift(r.entry);
  }

  // Try to resolve tool names from context.
  // Look for `.tool({ name: "..." }` near each replacement.
  resolveToolNames(code, replacements, entries);

  // Ensure `widget` is imported if not already
  if (!code.includes("widget") || !code.match(/\bimport\b[^;]*\bwidget\b/)) {
    if (
      transformed.includes('from "mcp-use"') ||
      transformed.includes("from 'mcp-use'")
    ) {
      // Add widget to existing mcp-use import
      transformed = transformed.replace(
        /import\s*\{([^}]*)\}\s*from\s*["']mcp-use["']/,
        (match, imports) => {
          if (imports.includes("widget")) return match;
          return `import { ${imports.trimEnd()}, widget } from "mcp-use"`;
        }
      );
    } else {
      transformed = `import { widget } from "mcp-use";\n${transformed}`;
    }
  }

  return { code: transformed, entries, changed: true };
}

/**
 * Try to determine which tool name each inline widget belongs to
 * by scanning for `.tool({ name: "..." }` in the surrounding code.
 */
function resolveToolNames(
  originalCode: string,
  replacements: Array<{ start: number; end: number; entry: InlineWidgetManifestEntry }>,
  entries: InlineWidgetManifestEntry[]
): void {
  const toolCallRe = /\.tool\s*\(\s*\{[^}]*name\s*:\s*["']([^"']+)["']/g;
  const toolCalls: Array<{ name: string; pos: number }> = [];

  let toolMatch;
  while ((toolMatch = toolCallRe.exec(originalCode)) !== null) {
    toolCalls.push({ name: toolMatch[1], pos: toolMatch.index });
  }

  for (const replacement of replacements) {
    // Find the closest preceding .tool() call
    let closestTool: { name: string; pos: number } | undefined;
    for (const tc of toolCalls) {
      if (tc.pos < replacement.start) {
        if (!closestTool || tc.pos > closestTool.pos) {
          closestTool = tc;
        }
      }
    }
    if (closestTool) {
      replacement.entry.toolName = closestTool.name;
    }
  }
}

/**
 * Create a Vite plugin for inline widget transformation.
 *
 * @param manifest - Shared manifest that accumulates discovered inline widgets
 * @param resolveImport - Function to resolve import paths
 * @returns Vite plugin object
 */
export function inlineWidgetTransformPlugin(
  manifest: InlineWidgetManifest,
  resolveImport?: (source: string, importer: string) => string | undefined
) {
  return {
    name: "mcp-use-inline-widget-transform",
    enforce: "post" as const,

    transform(code: string, id: string) {
      // Only process .tsx/.ts files (server code, not widget entries)
      if (!id.match(/\.[tj]sx?$/)) return null;
      // Skip node_modules
      if (id.includes("node_modules")) return null;
      // Skip .mcp-use temp directory (generated entries)
      if (id.includes(".mcp-use")) return null;
      // Quick bail: skip files that don't have .tool( calls
      if (!code.includes(".tool(") && !code.includes(".tool (")) return null;

      const result = transformInlineWidgets(
        code,
        resolveImport
          ? (source) => resolveImport(source, id)
          : undefined
      );

      if (!result.changed) return null;

      // Update manifest with discovered entries
      for (const entry of result.entries) {
        if (entry.toolName) {
          manifest.set(entry.toolName, entry);
        }
      }

      return {
        code: result.code,
        map: null, // TODO: source maps
      };
    },
  };
}
