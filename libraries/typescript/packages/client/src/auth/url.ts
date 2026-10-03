/**
 * URL sanitization utility
 *
 * Sanitizes URLs to prevent security issues by:
 * - Restricting to http/https protocols only
 * - Encoding URL components properly without double-encoding valid percent-encoded octets
 * - Validating hostnames, including RFC 3986 / WHATWG bracketed IPv6 literals
 */

/**
 * Validates that a hostname is structurally safe.
 *
 * Rejects hostnames containing unencoded or suspicious characters.
 * Supports standard DNS names, IPv4 addresses, and RFC 3986 / WHATWG bracketed IPv6 literals (e.g. `[::1]`).
 */
function isValidHostname(hostname: string): boolean {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const ipv6 = hostname.slice(1, -1);
    return ipv6.length > 0 && /^[0-9a-fA-F:.]+$/.test(ipv6);
  }
  return hostname === encodeURIComponent(hostname);
}

/**
 * Sanitizes a URL component by preserving valid percent-encoded sequences (%XX)
 * while encoding raw unescaped characters.
 */
function sanitizeEncodedComponent(
  value: string,
  encodeFn: (s: string) => string = encodeURIComponent
): string {
  return value.replace(
    /(%[0-9a-fA-F]{2})|([^%]+)|(%)/g,
    (_match, pct, plain, roguePct) => {
      if (pct) return pct;
      if (plain) return encodeFn(plain);
      if (roguePct) return "%25";
      return _match;
    }
  );
}

/**
 * Sanitizes a pathname by preserving segment structure and existing valid percent-encodings.
 */
function sanitizePath(pathname: string): string {
  if (!pathname || pathname === "/") return pathname;
  return pathname
    .split("/")
    .map((segment) => sanitizeEncodedComponent(segment, encodeURIComponent))
    .join("/");
}

/**
 * Sanitizes a URL string by encoding all components and validating the protocol.
 *
 * @param raw - The raw URL string to sanitize
 * @returns The sanitized URL as a string
 * @throws Error if the URL is invalid or uses an unsupported protocol
 */
export function sanitizeUrl(raw: string): string {
  const abort = () => {
    throw new Error(`Invalid url to pass to open(): ${raw}`);
  };

  let url!: URL;

  try {
    url = new URL(raw);
  } catch (_) {
    abort();
  }

  // Don't allow any other scheme than http(s)
  if (url.protocol !== "https:" && url.protocol !== "http:") abort();

  // Hostnames can't be updated, but let's reject if they contain anything suspicious
  if (!isValidHostname(url.hostname)) abort();

  // Forcibly sanitise all the pieces of the URL
  if (url.username) {
    url.username = sanitizeEncodedComponent(url.username, encodeURIComponent);
  }
  if (url.password) {
    url.password = sanitizeEncodedComponent(url.password, encodeURIComponent);
  }
  url.pathname = sanitizePath(url.pathname);
  if (url.search) {
    url.search =
      url.search.slice(0, 1) +
      Array.from(url.searchParams.entries()).map(sanitizeParam).join("&");
  }
  if (url.hash) {
    const hashContent = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
    url.hash =
      url.hash.slice(0, 1) + sanitizeEncodedComponent(hashContent, encodeURI);
  }

  return url.href;
}

/**
 * Helper function to sanitize URL search parameters
 */
function sanitizeParam([k, v]: [string, string]): string {
  return `${encodeURIComponent(k)}${v.length > 0 ? `=${encodeURIComponent(v)}` : ""}`;
}
