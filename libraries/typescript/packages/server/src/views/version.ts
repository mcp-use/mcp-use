import { sha256Hex } from "./sha256.js";
import type { ViewManifestEntry, ViewResourceFacts } from "./types.js";

/**
 * View settings an author declares on the bound tool that the host receives
 * with the view resource and may cache under its URI.
 */
type ViewVersionSettings = Pick<
  ViewResourceFacts,
  "csp" | "permissions" | "domain" | "prefersBorder"
>;

/** JSON with object keys sorted, so equal settings always hash the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Cache-key version for a production view, sent as the `?v=` query of its
 * resource URI.
 *
 * Hashes what a host caches under the URI: the view's built bundle (the
 * content-hashed file names of an external build, or the embedded JavaScript
 * and CSS of an inline build) and the settings declared on the bound tool's
 * `view` (`csp`, `permissions`, `domain`, `prefersBorder`). The version
 * therefore changes when the bundle or one of those settings changes, and
 * stays the same across rebuilds of identical sources, backend-only deploys,
 * and replicas. Values resolved per request or from the environment, such as
 * the serving origin, are not part of it.
 *
 * @param entry - Primed registry entry for the view.
 * @param settings - Author-declared view settings from the bound tool; omit
 * for a view no tool binds.
 * @returns 8 lowercase hex characters.
 *
 * @internal
 */
export function computeViewVersion(
  entry: ViewManifestEntry,
  settings?: ViewVersionSettings
): string {
  const parts =
    entry.kind === "inline"
      ? [entry.js, entry.css]
      : [...(entry.scripts ?? []), entry.entry, ...entry.css];
  const declared = stableStringify({
    csp: settings?.csp,
    permissions: settings?.permissions,
    domain: settings?.domain,
    prefersBorder: settings?.prefersBorder,
  });
  // A view with no declared settings hashes its bundle alone.
  if (declared !== "{}") {
    parts.push(declared);
  }
  return sha256Hex(parts.join("\0")).slice(0, 8);
}
