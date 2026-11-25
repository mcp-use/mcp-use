/**
 * SEP-2243 routing headers on `events/*`: the `Mcp-Name` header with the
 * `=?base64?…?=` sentinel for values that are not header-safe, and the
 * `Mcp-Param-{Name}` headers for `x-mcp-header` annotated arguments
 * (`events.mdx:736-775`).
 *
 * @packageDocumentation
 */

import type { EventDescriptor } from "./wire.js";
import { fromBase64, toBase64 } from "./encoding.js";

/** The header that carries `params.name` on `events/{subscribe,unsubscribe,poll,stream}`. */
export const MCP_NAME_HEADER = "Mcp-Name";

/** The header that carries the JSON-RPC method name. */
export const MCP_METHOD_HEADER = "Mcp-Method";

/** The prefix of every argument header (`Mcp-Param-{Name}`). */
export const MCP_PARAM_HEADER_PREFIX = "Mcp-Param-";

/** The JSON Schema annotation that mirrors an argument into a header. */
export const X_MCP_HEADER_KEY = "x-mcp-header";

const SENTINEL_PREFIX = "=?base64?";
const SENTINEL_SUFFIX = "?=";
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isSentinel(value: string): boolean {
  return value.startsWith(SENTINEL_PREFIX) && value.endsWith(SENTINEL_SUFFIX);
}

function needsSentinel(value: string): boolean {
  if (value.length === 0 || isSentinel(value) || value !== value.trim()) {
    return true;
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c !== 0x09 && (c < 0x20 || c > 0x7e)) return true;
  }
  return false;
}

/**
 * Encodes a string as an HTTP header value: a plain visible-ASCII value
 * without surrounding whitespace is returned unchanged; anything else (empty,
 * non-ASCII, control characters, surrounding whitespace, or a value that
 * already looks like a sentinel) becomes `=?base64?<base64 of UTF-8>?=`.
 *
 * @param value - The value to carry, such as an event name.
 * @returns The header value.
 */
export function encodeHeaderValue(value: string): string {
  if (!needsSentinel(value)) return value;
  return `${SENTINEL_PREFIX}${toBase64(new TextEncoder().encode(value))}${SENTINEL_SUFFIX}`;
}

/**
 * Decodes a header value written by {@link encodeHeaderValue}. A value without
 * the sentinel is returned unchanged.
 *
 * @param value - The received header value.
 * @returns The decoded value, or `undefined` when the sentinel's payload is not canonical base64 of valid UTF-8 (the server answers 400 / −32020).
 */
export function decodeHeaderValue(value: string): string | undefined {
  if (!isSentinel(value)) return value;
  const payload = value.slice(
    SENTINEL_PREFIX.length,
    value.length - SENTINEL_SUFFIX.length
  );
  if (!CANONICAL_BASE64.test(payload)) return undefined;
  const bytes = fromBase64(payload);
  if (!bytes) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Sets `Mcp-Name` to the event name, sentinel-encoded when needed. Uses
 * `headers.set`, so a value already present is replaced, never duplicated.
 *
 * @param headers - The request headers to modify.
 * @param name - The event name (`params.name`).
 */
export function setMcpNameHeader(headers: Headers, name: string): void {
  headers.set(MCP_NAME_HEADER, encodeHeaderValue(name));
}

/**
 * Reads and decodes `Mcp-Name`.
 *
 * @param headers - The request headers.
 * @returns The decoded event name; `undefined` when the header is absent or its sentinel does not decode (use `headers.has("mcp-name")` to tell the two apart).
 */
export function readMcpNameHeader(headers: Headers): string | undefined {
  const raw = headers.get(MCP_NAME_HEADER);
  return raw === null ? undefined : decodeHeaderValue(raw);
}

/** One `x-mcp-header` annotation found in an `inputSchema`. */
export interface XMcpHeaderDeclaration {
  /** Property path from the arguments root, following `properties` only. */
  path: readonly string[];
  /** The `{Name}` of `Mcp-Param-{Name}`, as declared. */
  headerName: string;
  /** The JSON Schema `type` of the annotated property: `string`, `integer` or `boolean`. */
  type: "string" | "integer" | "boolean";
}

/** The outcome of {@link scanXMcpHeaders}. */
export interface XMcpHeaderScan {
  /** The valid declarations found (all of them when `problem` is absent). */
  declarations: readonly XMcpHeaderDeclaration[];
  /** The first violated constraint, when the annotations are invalid. */
  problem?: string;
}

const RFC9110_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const PERMITTED_TYPES: ReadonlySet<string> = new Set([
  "string",
  "integer",
  "boolean",
]);
// Subschema keywords an annotation must not sit under (not reachable through `properties` alone).
const UNREACHABLE_KEYWORDS = [
  "items",
  "prefixItems",
  "contains",
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "patternProperties",
  "dependentSchemas",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "if",
  "then",
  "else",
  "$defs",
  "definitions",
] as const;
const MAP_KEYWORDS: ReadonlySet<string> = new Set([
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);

function pathName(path: readonly string[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
}

/**
 * Collects the `x-mcp-header` annotations of an event's `inputSchema` and
 * checks the transport's constraints: only on properties reachable through
 * `properties` keys, a non-empty RFC 9110 token, a `string`, `integer` or
 * `boolean` property type, and names unique case-insensitively.
 *
 * @param inputSchema - The event's `inputSchema` (JSON Schema).
 * @returns The declarations, plus the first problem when the annotations are invalid.
 */
export function scanXMcpHeaders(inputSchema: unknown): XMcpHeaderScan {
  const declarations: XMcpHeaderDeclaration[] = [];
  const seen = new Map<string, string>();
  let problem: string | undefined;
  const report = (message: string): void => {
    problem ??= message;
  };

  const visit = (node: unknown, path: string[], reachable: boolean): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node))
      return;
    const schema = node as Record<string, unknown>;
    if (X_MCP_HEADER_KEY in schema) {
      const raw = schema[X_MCP_HEADER_KEY];
      const type = schema.type;
      if (!reachable || path.length === 0) {
        report(
          `${pathName(path)}: x-mcp-header is only allowed on properties reachable through "properties"`
        );
      } else if (typeof raw !== "string" || !RFC9110_TOKEN.test(raw)) {
        report(
          `${pathName(path)}: x-mcp-header must be a non-empty RFC 9110 token`
        );
      } else if (typeof type !== "string" || !PERMITTED_TYPES.has(type)) {
        report(
          `${pathName(path)}: x-mcp-header needs a string, integer or boolean property`
        );
      } else {
        const prior = seen.get(raw.toLowerCase());
        if (prior !== undefined) {
          report(
            `x-mcp-header "${raw}" duplicates "${prior}" (case-insensitive)`
          );
        } else {
          seen.set(raw.toLowerCase(), raw);
          declarations.push({
            path,
            headerName: raw,
            type: type as XMcpHeaderDeclaration["type"],
          });
        }
      }
    }
    const properties = schema.properties;
    if (properties !== null && typeof properties === "object") {
      for (const [key, child] of Object.entries(
        properties as Record<string, unknown>
      )) {
        visit(child, [...path, key], reachable);
      }
    }
    for (const keyword of UNREACHABLE_KEYWORDS) {
      const sub = schema[keyword];
      if (sub === undefined) continue;
      const branches: unknown[] = Array.isArray(sub)
        ? sub
        : MAP_KEYWORDS.has(keyword) && sub !== null && typeof sub === "object"
          ? Object.values(sub)
          : [sub];
      for (const branch of branches)
        visit(branch, [...path, `<${keyword}>`], false);
    }
  };

  visit(inputSchema, [], true);
  return problem === undefined ? { declarations } : { declarations, problem };
}

/**
 * Validates the `x-mcp-header` annotations of an event's `inputSchema`. A
 * client excludes an event whose annotations are invalid from `events/list`
 * results (`events.mdx:772`); a server refuses to register it.
 *
 * @param inputSchema - The event's `inputSchema`.
 * @returns `{ ok: true }`, or the first violated constraint.
 */
export function validateXMcpHeaderAnnotations(
  inputSchema: Record<string, unknown>
):
  | {
      /** The annotations are valid. */
      ok: true;
    }
  | {
      /** The annotations are invalid. */
      ok: false;
      /** The first violated constraint. */
      reason: string;
    } {
  const scan = scanXMcpHeaders(inputSchema);
  return scan.problem === undefined
    ? { ok: true }
    : { ok: false, reason: scan.problem };
}

function valueAt(root: unknown, path: readonly string[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function primitiveToString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      return undefined;
    return String(value);
  }
  return undefined;
}

/**
 * Builds the `Mcp-Param-{Name}` headers a client sends with an `events/*`
 * request: one per annotated property that has a primitive value in the
 * arguments, sentinel-encoded when needed. Properties that are absent or
 * `null` get no header. An event with invalid annotations gets no headers.
 *
 * @param descriptor - The event's descriptor from `events/list`.
 * @param args - The request's `arguments`.
 * @returns Header names and values, for example `{ "Mcp-Param-Region": "us-west1" }`.
 */
export function paramHeadersFor(
  descriptor: EventDescriptor,
  args: Record<string, unknown>
): Record<string, string> {
  const scan = scanXMcpHeaders(descriptor.inputSchema);
  if (scan.problem !== undefined) return {};
  const out: Record<string, string> = {};
  for (const decl of scan.declarations) {
    const value = valueAt(args, decl.path);
    if (value === undefined || value === null) continue;
    const text = primitiveToString(value);
    if (text === undefined) continue;
    out[`${MCP_PARAM_HEADER_PREFIX}${decl.headerName}`] =
      encodeHeaderValue(text);
  }
  return out;
}

/** The outcome of {@link checkParamHeaders}. */
export type ParamHeaderCheck =
  | {
      /** Every header agrees with the arguments (or is not expected). */
      ok: true;
    }
  | {
      /** A header disagrees with the arguments. */
      ok: false;
      /** The header name, for example `Mcp-Param-Region`. */
      header: string;
      /** `missing`: the argument has a value but no header was sent. `mismatch`: the values differ. `invalid_encoding`: the sentinel does not decode. */
      problem: "missing" | "mismatch" | "invalid_encoding";
    };

/**
 * Compares the `Mcp-Param-*` headers of a request with its `arguments`, for
 * every valid `x-mcp-header` declaration of the event's `inputSchema`. A
 * header is expected only when the argument has a value; integers compare
 * numerically (`42.0` equals `42`), everything else as decoded strings.
 * Callers decide whether `missing` is an error (`compatibility.mcpName`).
 *
 * @param inputSchema - The event's `inputSchema`.
 * @param args - The request's `arguments` (absent and `null` mean `{}`).
 * @param headers - The request headers.
 * @returns `{ ok: true }`, or the first header that disagrees.
 */
export function checkParamHeaders(
  inputSchema: Record<string, unknown>,
  args: Record<string, unknown> | null | undefined,
  headers: Headers
): ParamHeaderCheck {
  for (const decl of scanXMcpHeaders(inputSchema).declarations) {
    const header = `${MCP_PARAM_HEADER_PREFIX}${decl.headerName}`;
    const received = headers.get(header);
    const value = valueAt(args ?? {}, decl.path);
    if (value === undefined || value === null) continue;
    const expected = primitiveToString(value);
    if (expected === undefined) {
      if (received === null && typeof value !== "object") continue;
      return {
        ok: false,
        header,
        problem: received === null ? "missing" : "mismatch",
      };
    }
    if (received === null) return { ok: false, header, problem: "missing" };
    const decoded = decodeHeaderValue(received);
    if (decoded === undefined) {
      return { ok: false, header, problem: "invalid_encoding" };
    }
    const numeric =
      decl.type === "integer" &&
      typeof value === "number" &&
      /^-?\d+(\.\d+)?$/.test(decoded);
    const equal = numeric ? Number(decoded) === value : decoded === expected;
    if (!equal) return { ok: false, header, problem: "mismatch" };
  }
  return { ok: true };
}
