/**
 * Returns true when `serverUrl` points at the local machine (loopback).
 *
 * Used to decide chat routing: the hosted cloud chat backend runs server-side
 * and cannot reach a user's localhost MCP server, so chat must fall back to
 * client-side (in-browser) streaming for these URLs.
 */
// Matches the full IPv4 loopback range 127.0.0.0/8 — i.e. four dotted octets
// (0-255) whose first octet is exactly 127. Anchored so hostnames that merely
// start with "127." (e.g. "127.example.com") are NOT treated as loopback.
const IPV4_LOOPBACK_RE =
  /^127\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])(?:\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])){2}$/;

export function isLocalhostServerUrl(serverUrl: string): boolean {
  try {
    const u = new URL(serverUrl);
    // Strip any surrounding brackets so a bracketed IPv6 literal (e.g. "[::1]")
    // compares equal to the bare "::1" form below.
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      h === "localhost" ||
      h === "::1" ||
      h === "0.0.0.0" ||
      IPV4_LOOPBACK_RE.test(h)
    );
  } catch {
    return false;
  }
}
