/**
 * SSR-safe metadata modules for deprecated v1 widget entries.
 *
 * Legacy widget files are browser entry points and may read `window` or
 * `document` at module scope. The CLI therefore extracts only the exported
 * `widgetMetadata` initializer and the imports it references when server-side
 * build validation needs registration metadata.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_PREFIX = "virtual:mcp-use/legacy-widget-metadata:";
const RESOLVED_PREFIX = `\0${VIRTUAL_PREFIX}`;

/** Return the virtual module id for one legacy widget's metadata export. */
export function legacyWidgetMetadataId(entryPath: string): string {
  return `${VIRTUAL_PREFIX}${encodeURIComponent(entryPath)}`;
}

/**
 * Load only `widgetMetadata` from a legacy browser entry.
 *
 * @internal
 */
export function legacyWidgetMetadataPlugin(): Plugin {
  return {
    name: "mcp-use-legacy-widget-metadata",
    resolveId(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return undefined;
      return `\0${id}`;
    },
    async load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return undefined;
      const entryPath = decodeURIComponent(id.slice(RESOLVED_PREFIX.length));
      this.addWatchFile(entryPath);
      const source = await readFile(entryPath, "utf8");
      return extractMetadataModule(source, entryPath);
    },
  };
}

function extractMetadataModule(source: string, entryPath: string): string {
  const declaration = /\bexport\s+const\s+widgetMetadata\b/g.exec(source);
  if (declaration === null) {
    return "export const widgetMetadata = undefined;\n";
  }

  const equals = findInitializerEquals(
    source,
    declaration.index + declaration[0].length
  );
  if (equals === -1) {
    throw new Error(
      `Could not read widgetMetadata from ${entryPath}: expected an exported const initializer.`
    );
  }
  const end = findExpressionEnd(source, equals + 1);
  const initializer = source.slice(equals + 1, end).trim();
  if (initializer === "") {
    throw new Error(
      `Could not read widgetMetadata from ${entryPath}: the initializer is empty.`
    );
  }

  const imports = referencedImports(source, initializer, entryPath);
  return `${imports.join("\n")}\nexport const widgetMetadata = ${initializer};\n`;
}

function findInitializerEquals(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "=" && source[index + 1] !== ">") return index;
  }
  return -1;
}

function findExpressionEnd(source: string, start: number): number {
  const stack: string[] = [];
  let quote: "'" | '"' | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      stack.pop();
      continue;
    }
    if (char === ";" && stack.length === 0) return index;
  }
  return source.length;
}

function referencedImports(
  source: string,
  initializer: string,
  entryPath: string
): string[] {
  const imports: string[] = [];
  const importPattern =
    /\bimport\s+([\s\S]*?)\s+from\s+(["'])([^"']+)\2\s*(?:with\s*\{[^}]*\})?\s*;?/g;
  for (const match of source.matchAll(importPattern)) {
    const statement = match[0];
    const clause = match[1] ?? "";
    const specifier = match[3] ?? "";
    const names = importedLocalNames(clause);
    if (!names.some((name) => identifierAppears(initializer, name))) continue;
    const resolvedSpecifier = specifier.startsWith(".")
      ? resolve(dirname(entryPath), specifier)
      : specifier;
    imports.push(statement.replace(specifier, resolvedSpecifier));
  }
  return imports;
}

function importedLocalNames(clause: string): string[] {
  const names: string[] = [];
  const withoutType = clause.replace(/^\s*type\s+/, "").trim();
  const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(withoutType);
  if (namespace?.[1] !== undefined) names.push(namespace[1]);

  const named = /\{([\s\S]*?)\}/.exec(withoutType)?.[1];
  if (named !== undefined) {
    for (const item of named.split(",")) {
      const cleaned = item.trim().replace(/^type\s+/, "");
      if (cleaned === "") continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(cleaned)?.[1];
      names.push(alias ?? cleaned.split(/\s+/)[0]!);
    }
  }

  const beforeNamed = withoutType.split(/[,{*]/, 1)[0]?.trim();
  if (beforeNamed !== undefined && /^[A-Za-z_$][\w$]*$/.test(beforeNamed)) {
    names.push(beforeNamed);
  }
  return names;
}

function identifierAppears(source: string, identifier: string): boolean {
  return new RegExp(`(^|[^\\w$])${escapeRegExp(identifier)}([^\\w$]|$)`).test(
    source
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
