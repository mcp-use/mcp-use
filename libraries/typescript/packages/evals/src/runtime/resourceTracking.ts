import type { MCPSession } from "mcp-use";
import type { ResourceAccess } from "./types.js";

/** WeakSet to track which sessions have already been wrapped */
const wrappedSessions = new WeakSet<MCPSession>();

/**
 * Extract a human-readable name from a resource URI.
 * Takes the last path component, ignoring query strings and fragments.
 *
 * @param uri - Resource URI to extract name from
 * @returns Resource name
 * @internal
 *
 * @example
 * ```typescript
 * extractResourceName("config://app/settings?foo=bar"); // "settings"
 * ```
 */
function extractResourceName(uri: string): string {
  const trimmed = uri.replace(/[#?].*$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || uri;
}

/**
 * Attach resource access tracking to MCP sessions.
 * Wraps session.readResource() to log all resource accesses.
 *
 * @param sessions - Map of MCP sessions to track
 * @param log - Array to append resource access records to
 * @internal
 */
export function attachResourceTracking(
  sessions: Record<string, MCPSession>,
  log: ResourceAccess[]
): void {
  for (const session of Object.values(sessions)) {
    if (wrappedSessions.has(session)) continue;
    wrappedSessions.add(session);

    const originalRead = session.readResource.bind(session);
    session.readResource = async (uri: string, options?: unknown) => {
      const result = await originalRead(uri, options as any);
      log.push({
        name: extractResourceName(uri),
        uri,
        data: result,
        accessedAt: Date.now(),
      });
      return result;
    };
  }
}
