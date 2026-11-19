import { sha256Hex } from "./sha256.js";
import type { ViewManifestEntry } from "./types.js";

/**
 * Cache-key version for a production view, sent as the `?v=` query of its
 * resource URI.
 *
 * Hashes the view's built bundle only: the content-hashed file names of an
 * external build, or the embedded JavaScript and CSS of an inline build. The
 * version therefore changes exactly when the bundle changes, and stays the
 * same across rebuilds of identical sources, backend-only deploys, and
 * replicas. Server-side view settings such as `csp` are not part of it.
 *
 * @param entry - Primed registry entry for the view.
 * @returns 8 lowercase hex characters.
 *
 * @internal
 */
export function computeViewVersion(entry: ViewManifestEntry): string {
  const parts =
    entry.kind === "inline"
      ? [entry.js, entry.css]
      : [...(entry.scripts ?? []), entry.entry, ...entry.css];
  return sha256Hex(parts.join("\0")).slice(0, 8);
}
