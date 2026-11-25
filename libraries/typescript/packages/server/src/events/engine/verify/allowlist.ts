/**
 * Allowlist strategy (D29): `webhook.allowlist` patterns are pre-verified.
 * A string pattern matches the URL exactly, its whole origin, or as a prefix
 * ending in `/`; a RegExp is tested against the full URL.
 *
 * @internal
 */

/** A configured URL pattern. */
export type UrlPattern = string | RegExp;

/** Whether `url` matches any pattern. */
export function matchesUrlPattern(
  url: string,
  patterns: readonly UrlPattern[]
): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return patterns.some((p) => {
    if (typeof p !== "string") return p.test(url);
    if (p === url || p === origin) return true;
    return p.endsWith("/") && url.startsWith(p);
  });
}
