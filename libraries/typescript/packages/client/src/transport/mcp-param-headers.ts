/**
 * `Mcp-Param-*` header mirroring for tool parameters annotated with
 * `x-mcp-header` (SEP-2243).
 *
 * The SDK mirrors these parameters itself outside browsers, but skips the
 * mirroring in browser runtimes and does not export its helpers. This module
 * follows the SDK's encoding rules so the connector can fill that gap.
 */

const MCP_PARAM_HEADER_PREFIX = "Mcp-Param-";
const X_MCP_HEADER_KEY = "x-mcp-header";

/** RFC 9110 §5.1 `token` syntax, required of every `x-mcp-header` name. */
const RFC9110_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** JSON Schema `type` values the SDK accepts on an `x-mcp-header` property. */
const PERMITTED_TYPES = new Set(["string", "integer", "boolean", "number"]);

const BASE64_SENTINEL_PREFIX = "=?base64?";
const BASE64_SENTINEL_SUFFIX = "?=";

interface McpParamDeclaration {
  path: string[];
  headerName: string;
}

/**
 * Whether the SDK mirrors `x-mcp-header` parameters itself in this runtime.
 * Matches the SDK's own environment check.
 */
export function sdkMirrorsMcpParamHeaders(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return g.window === undefined || g.document === undefined;
}

/**
 * Collects `x-mcp-header` declarations reachable through a chain of
 * `properties` keys. Declarations with an invalid header name or a
 * non-primitive type are skipped.
 */
function collectDeclarations(
  schema: unknown,
  path: string[],
  seen: Set<string>,
  out: McpParamDeclaration[]
): void {
  if (schema === null || typeof schema !== "object") return;
  const node = schema as Record<string, unknown>;

  const headerName = node[X_MCP_HEADER_KEY];
  if (
    path.length > 0 &&
    typeof headerName === "string" &&
    RFC9110_TOKEN.test(headerName) &&
    typeof node.type === "string" &&
    PERMITTED_TYPES.has(node.type) &&
    !seen.has(headerName.toLowerCase())
  ) {
    seen.add(headerName.toLowerCase());
    out.push({ path, headerName });
  }

  const properties = node.properties;
  if (properties !== null && typeof properties === "object") {
    for (const [key, child] of Object.entries(properties)) {
      collectDeclarations(child, [...path, key], seen, out);
    }
  }
}

function valueAtPath(root: unknown, path: string[]): unknown {
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
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      return undefined;
    }
    return String(value);
  }
  return undefined;
}

/**
 * `true` when the value cannot be sent as a plain ASCII HTTP field value:
 * it is empty, has leading or trailing whitespace, contains a character
 * outside printable ASCII or tab, or already looks like the Base64 sentinel.
 */
function needsBase64(value: string): boolean {
  if (value.length === 0) return true;
  if (
    value.startsWith(BASE64_SENTINEL_PREFIX) &&
    value.endsWith(BASE64_SENTINEL_SUFFIX)
  ) {
    return true;
  }
  if (value !== value.trim()) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 9 || (code >= 32 && code <= 126)) continue;
    return true;
  }
  return false;
}

function utf8ToBase64(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodeValue(value: string): string {
  return needsBase64(value)
    ? `${BASE64_SENTINEL_PREFIX}${utf8ToBase64(value)}${BASE64_SENTINEL_SUFFIX}`
    : value;
}

/**
 * Builds the `Mcp-Param-{Name}` headers for one `tools/call`.
 *
 * @param inputSchema - The tool's JSON Schema `inputSchema`.
 * @param args - The arguments being sent in the request body.
 * @returns Header names mapped to encoded values. Parameters that are
 *   absent, `null`, or not primitives are omitted.
 */
export function buildMcpParamHeaders(
  inputSchema: unknown,
  args: Record<string, unknown> | undefined
): Record<string, string> {
  const declarations: McpParamDeclaration[] = [];
  collectDeclarations(inputSchema, [], new Set(), declarations);

  const headers: Record<string, string> = {};
  for (const { path, headerName } of declarations) {
    const raw = valueAtPath(args, path);
    if (raw === undefined || raw === null) continue;
    const value = primitiveToString(raw);
    if (value === undefined) continue;
    headers[`${MCP_PARAM_HEADER_PREFIX}${headerName}`] = encodeValue(value);
  }
  return headers;
}
