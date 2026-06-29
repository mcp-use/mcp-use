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
   * Additional headers to include in requests
   */
  headers?: Record<string, string>;
  /**
   * @deprecated Use `headers` instead. This option will be removed in a future version.
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
 */
export function applyProxyConfig(
  originalUrl: string,
  proxyConfig?: ProxyConfig
): ProxyResult {
  // Support both new and deprecated names with deprecation warning
  const proxyHeaders = proxyConfig?.headers ?? proxyConfig?.customHeaders ?? {};
  if (proxyConfig?.customHeaders && !proxyConfig?.headers) {
    console.warn(
      '[applyProxyConfig] The "customHeaders" option in proxyConfig is deprecated. Use "headers" instead.'
    );
  }

  // No proxy configured - return original URL with any custom headers
  if (!proxyConfig?.proxyAddress) {
    return {
      url: originalUrl,
      headers: proxyHeaders,
    };
  }

  // Parse URLs
  const proxyUrl = new URL(proxyConfig.proxyAddress);
  const targetUrl = new URL(originalUrl);

  // Combine proxy base with original path and query parameters
  const finalUrl = `${proxyUrl.origin}${proxyUrl.pathname}${targetUrl.pathname}${targetUrl.search}`;

  // Build headers with X-Target-URL for the proxy to know where to forward
  const headers: Record<string, string> = {
    "X-Target-URL": originalUrl,
    ...proxyHeaders,
  };

  return { url: finalUrl, headers };
}
