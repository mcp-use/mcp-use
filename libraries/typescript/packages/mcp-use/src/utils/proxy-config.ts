/**
 * Proxy configuration utilities for MCP connections
 * @module proxy-config
 */

/**
 * Configuration for proxying MCP server connections
 */
export interface ProxyConfig {
  /**
   * The proxy server address (e.g., "http://localhost:3001/inspector/api/proxy")
   */
  proxyAddress?: string;
  /**
   * Additional custom headers to include in requests
   */
  customHeaders?: Record<string, string>;
}

/**
 * Result of applying proxy configuration to a URL
 */
export interface ProxyResult {
  /**
   * The final URL to connect to (either original or proxied)
   */
  url: string;
  /**
   * Headers to include in the request (including X-Target-URL if proxied)
   */
  headers: Record<string, string>;
}

/**
 * Apply proxy configuration to an MCP server URL
 *
 * When a proxy is configured, this function:
 * 1. Rewrites the URL to point to the proxy endpoint
 * 2. Adds the original URL as the X-Target-URL header
 * 3. Merges any additional custom headers
 *
 * When no proxy is configured, it returns the original URL with custom headers.
 *
 * @param originalUrl - The original MCP server URL to connect to
 * @param proxyConfig - Optional proxy configuration
 * @returns Object containing the final URL and headers to use
 *
 * @example
 * ```typescript
 * // Without proxy
 * const result = applyProxyConfig("https://api.example.com/sse");
 * // { url: "https://api.example.com/sse", headers: {} }
 *
 * // With proxy
 * const result = applyProxyConfig(
 *   "https://api.example.com/sse",
 *   {
 *     proxyAddress: "http://localhost:3001/proxy",
 *     customHeaders: { "Authorization": "Bearer token" }
 *   }
 * );
 * // {
 * //   url: "http://localhost:3001/proxy/sse",
 * //   headers: {
 * //     "X-Target-URL": "https://api.example.com/sse",
 * //     "Authorization": "Bearer token"
 * //   }
 * // }
 * ```
 */
export function applyProxyConfig(
  originalUrl: string,
  proxyConfig?: ProxyConfig
): ProxyResult {
  // No proxy configured - return original URL with any custom headers
  if (!proxyConfig?.proxyAddress) {
    return {
      url: originalUrl,
      headers: proxyConfig?.customHeaders || {},
    };
  }

  // Parse URLs
  const proxyUrl = new URL(proxyConfig.proxyAddress);
  const targetUrl = new URL(originalUrl);

  // Combine proxy base with original path and query parameters
  // Example: proxy="http://localhost:3001/proxy" + target="/sse?foo=bar"
  // Result: "http://localhost:3001/proxy/sse?foo=bar"
  const finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${targetUrl.pathname}${targetUrl.search}`;

  // Build headers with X-Target-URL for the proxy to know where to forward
  const headers: Record<string, string> = {
    "X-Target-URL": originalUrl,
    ...proxyConfig.customHeaders,
  };

  return { url: finalUrl, headers };
}
