import { synthesizeViewDocument } from "./document.js";
import type { ViewManifestEntry, ViewResourceFacts } from "./types.js";
import { sha256Hex } from "./sha256.js";
import { buildResourceUiMeta } from "./wire.js";

/**
 * Fixed origin standing in for the request-resolved assets base while
 * hashing, so every replica and rebuild hashes the same document text.
 */
const HASH_ASSETS_BASE = "https://assets.invalid";

/** Fixed MCP mount standing in for the server's `basePath` while hashing. */
const HASH_BASE_PATH = "/mcp";

/**
 * Serialize JSON-compatible data with object keys sorted, so equal values
 * always produce equal text regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Content-derived version for a production view resource URI.
 *
 * Hashes what the view serves, independent of any single request:
 * - the synthesized HTML document, which covers the built JS/CSS (inline
 *   content, or content-hashed asset file names) and the document template
 *   of the running mcp-use version;
 * - the resource `_meta` the server emits for the view (CSP, permissions,
 *   domain, border, description, display modes), with environment-supplied
 *   CSP domains merged in.
 *
 * Identical sources therefore produce identical versions across rebuilds and
 * replicas, a change to one view changes only that view's version, and a
 * backend-only change keeps every version.
 *
 * @param viewName - View directory / registry key.
 * @param entry - Primed registry entry for the view.
 * @param facts - Author-declared resource facts for the view.
 * @returns 16 lowercase hex characters.
 *
 * @internal
 */
export function computeViewVersion(
  viewName: string,
  entry: ViewManifestEntry,
  facts: ViewResourceFacts | undefined
): string {
  const document = synthesizeViewDocument(
    entry,
    HASH_ASSETS_BASE,
    HASH_BASE_PATH,
    viewName
  );
  const meta = buildResourceUiMeta(facts, { serverOrigin: "" });
  return sha256Hex(
    [
      viewName,
      document,
      stableStringify({ description: facts?.description, meta }),
    ].join("\0")
  ).slice(0, 16);
}
