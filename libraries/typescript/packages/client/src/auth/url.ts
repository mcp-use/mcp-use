/**
 * URL sanitization utility
 *
 * Sanitizes URLs to prevent security issues by:
 * - Restricting to http/https protocols only
 * - Validating URL structure using the WHATWG URL parser
 */

/**
 * Sanitizes a URL string by validating the protocol and returning its normalized href.
 *
 * @param raw - The raw URL string to sanitize
 * @returns The sanitized URL as a string
 * @throws Error if the URL is invalid or uses an unsupported protocol
 */
export function sanitizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid url to pass to open(): ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid url to pass to open(): ${raw}`);
  }

  return url.href;
}
