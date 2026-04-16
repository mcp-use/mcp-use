/**
 * Extracts inline widget JSX metadata from a handler's toString() output.
 *
 * When users write inline JSX in tool handlers, the TSX compiler produces
 * calls like `jsx(Component, { props..., _output: ..., _invoking: "..." })`.
 * At registration time we inspect handler.toString() to extract metadata
 * (component names, status text, CSP config, etc.) for populating tools/list.
 *
 * Handles real-world compiler variations:
 *   jsx / jsxs / _jsx / _jsxs / jsxDEV / _jsxDEV call patterns
 *   Double-quoted, single-quoted, and plain backtick string values
 *   Minified booleans (!0 / !1)
 *   Mixed-quote string arrays
 *   Nested CSP objects with URL-containing strings
 *   Multiple conditional JSX returns
 *   Graceful skip for template literals with interpolation
 */

export interface ExtractedInlineJsxMeta {
  /** All unique PascalCase component names found in JSX calls. */
  componentNames: string[];
  /** Status text while tool is running. */
  invoking?: string;
  /** Status text after tool completes. */
  invoked?: string;
  /** Visual border preference. */
  prefersBorder?: boolean;
  /** File parameter names (Apps SDK). */
  fileParams?: string[];
  /** Content Security Policy configuration. */
  csp?: Record<string, any>;
}

/**
 * Matches compiled JSX calls from all common compilers/bundlers.
 *
 *   jsx(Comp, ...)     — standard React JSX runtime
 *   jsxs(Comp, ...)    — React JSX runtime (multiple children)
 *   _jsx(Comp, ...)    — underscore-prefixed (some bundlers)
 *   _jsxs(Comp, ...)   — underscore + children variant
 *   jsxDEV(Comp, ...)  — React development mode
 *   _jsxDEV(Comp, ...) — dev mode with underscore prefix
 *
 * [A-Z]\w* ensures we only match PascalCase identifiers,
 * excluding native elements like jsx("div", ...).
 */
const JSX_CALL_RE = /(?:_?jsxs?|_?jsxDEV)\s*\(\s*([A-Z]\w*)\s*,/g;

/**
 * Extract inline JSX metadata from a handler's source code string.
 * Returns undefined if no inline widget JSX is detected.
 * Never throws — all extraction is best-effort.
 */
export function extractInlineJsxMetadata(
  src: string,
): ExtractedInlineJsxMeta | undefined {
  try {
    const componentNames: string[] = [];
    const re = new RegExp(JSX_CALL_RE.source, JSX_CALL_RE.flags);
    let m;
    while ((m = re.exec(src)) !== null) {
      if (!componentNames.includes(m[1])) componentNames.push(m[1]);
    }

    // No PascalCase JSX calls, or no _output prop → not an inline widget handler
    if (componentNames.length === 0 || !src.includes("_output")) {
      return undefined;
    }

    return {
      componentNames,
      invoking: extractStringProp(src, "_invoking"),
      invoked: extractStringProp(src, "_invoked"),
      prefersBorder: extractBooleanProp(src, "_prefersBorder"),
      fileParams: extractStringArrayProp(src, "_fileParams"),
      csp: extractObjectProp(src, "_csp"),
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract a string-valued prop from source code.
 *
 * Handles:
 *   _prop: "value"      — double quotes
 *   _prop: 'value'      — single quotes
 *   _prop: `value`      — backtick (no interpolation)
 *   _prop: `val ${x}`   — returns undefined (interpolation not extractable)
 */
function extractStringProp(
  src: string,
  propName: string,
): string | undefined {
  const re = new RegExp(propName + "\\s*:\\s*([\"'`])");
  const match = re.exec(src);
  if (!match) return undefined;

  const quote = match[1];
  const valueStart = match.index + match[0].length;

  let i = valueStart;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2; // skip escaped character
      continue;
    }
    if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
      return undefined; // template literal with interpolation — bail
    }
    if (src[i] === quote) {
      return src.slice(valueStart, i);
    }
    i++;
  }
  return undefined;
}

/**
 * Extract a boolean-valued prop from source code.
 *
 * Handles:
 *   _prop: true   /  _prop: false
 *   _prop: !0     (minified true)
 *   _prop: !1     (minified false)
 *
 * The negative lookahead (?![\w$]) prevents partial matches
 * against longer identifiers like `trueValue`.
 */
function extractBooleanProp(
  src: string,
  propName: string,
): boolean | undefined {
  const re = new RegExp(propName + "\\s*:\\s*(true|false|!0|!1)(?![\\w$])");
  const match = re.exec(src);
  if (!match) return undefined;
  return match[1] === "true" || match[1] === "!0";
}

/**
 * Extract a string-array prop from source code.
 *
 * Handles:
 *   _prop: ["a"]
 *   _prop: ['a']
 *   _prop: [`a`]
 *   _prop: ["a", 'b', `c`]   — mixed quotes
 */
function extractStringArrayProp(
  src: string,
  propName: string,
): string[] | undefined {
  // [^\]] is safe here because string array items won't contain literal ]
  const re = new RegExp(propName + "\\s*:\\s*\\[([^\\]]*)\\]");
  const match = re.exec(src);
  if (!match) return undefined;
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^["'`]|["'`]$/g, ""))
    .filter(Boolean);
}

/**
 * Extract an object-valued prop from source code.
 *
 * Uses string-aware brace matching so braces inside string values
 * (e.g. URLs) don't confuse the depth counter. Then converts the
 * JS object literal to JSON for parsing.
 */
function extractObjectProp(
  src: string,
  propName: string,
): Record<string, any> | undefined {
  const re = new RegExp(propName + "\\s*:");
  const match = re.exec(src);
  if (!match) return undefined;

  // Skip whitespace after the colon to find the opening brace
  let braceStart = match.index + match[0].length;
  while (braceStart < src.length && /\s/.test(src[braceStart])) braceStart++;
  if (braceStart >= src.length || src[braceStart] !== "{") return undefined;

  const braceEnd = findMatchingBrace(src, braceStart);
  if (braceEnd === -1) return undefined;

  return parseJsObjectLiteral(src.slice(braceStart, braceEnd + 1));
}

/**
 * Find the matching closing brace for an opening brace at `start`.
 *
 * String-aware: tracks whether we're inside a single-quoted,
 * double-quoted, or backtick string so that braces within string
 * values don't affect the depth counter.
 *
 * Returns the index of the closing brace, or -1 if unbalanced.
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
 * Convert a JS object literal string to a parsed object.
 *
 * Three-step conversion:
 * 1. Quote bare keys — the lookbehind (?<=[\{,]\s*) restricts matches
 *    to identifier positions (after { or ,), so colons inside string
 *    values like "https://..." are left untouched.
 * 2. Single quotes → double quotes for JSON compatibility.
 * 3. Strip trailing commas before } or ] (valid JS, invalid JSON).
 *
 * Returns undefined if the result isn't valid JSON.
 */
function parseJsObjectLiteral(
  objStr: string,
): Record<string, any> | undefined {
  try {
    const json = objStr
      .replace(/(?<=[\{,]\s*)(\w+)\s*:/g, '"$1":')
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
