/**
 * Returns true when `serverUrl` points at the local machine (loopback).
 *
 * Used to decide chat routing: the hosted cloud chat backend runs server-side
 * and cannot reach a user's localhost MCP server, so chat must fall back to
 * client-side (in-browser) streaming for these URLs.
 */
export function isLocalhostServerUrl(serverUrl: string): boolean {
  try {
    const u = new URL(serverUrl);
    // Strip any surrounding brackets so a bracketed IPv6 literal (e.g. "[::1]")
    // compares equal to the bare "::1" form below.
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0"
    );
  } catch {
    return false;
  }
}
