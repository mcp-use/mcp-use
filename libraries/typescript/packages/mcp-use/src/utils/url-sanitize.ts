/**
 * URL sanitization utility
 * 
 * Sanitizes URLs to prevent security issues by:
 * - Restricting to http/https protocols only
 * - Encoding URL components properly
 * - Validating hostnames
 */

/**
 * Sanitizes a URL string by encoding all components and validating the protocol.
 * 
 * @param raw - The raw URL string to sanitize
 * @returns The sanitized URL as a string
 * @throws Error if the URL is invalid or uses an unsupported protocol
 */
export function sanitizeUrl(raw: string): string {
  const abort = () => {
    throw new Error(`Invalid url to pass to open(): ${raw}`)
  }

  let url!: URL

  try {
    url = new URL(raw)
  } catch (_) {
    abort()
  }

  // Don't allow any other scheme than http(s)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') abort()

  // Hostnames can't be updated, but let's reject if they contain anything suspicious
  if (url.hostname !== encodeURIComponent(url.hostname)) abort()

  // Forcibly sanitise all the pieces of the URL
  if (url.username) url.username = encodeURIComponent(url.username)
  if (url.password) url.password = encodeURIComponent(url.password)
  url.pathname = url.pathname.slice(0, 1) + encodeURIComponent(url.pathname.slice(1)).replace(/%2f/ig, '/')
  url.search = url.search.slice(0, 1) + Array.from(url.searchParams.entries()).map(sanitizeParam).join('&')
  url.hash = url.hash.slice(0, 1) + encodeURIComponent(url.hash.slice(1))

  return url.href
}

/**
 * Helper function to sanitize URL search parameters
 */
function sanitizeParam([k, v]: [string, string]): string {
  return `${encodeURIComponent(k)}${v.length > 0 ? `=${encodeURIComponent(v)}` : ''}`
}

