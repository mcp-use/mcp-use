/**
 * API URL utilities for inspector
 * Handles both embedded mode (with custom API URL) and standalone mode (relative URLs)
 */

/**
 * Get the full API URL for a given path.
 * In embedded mode, uses the custom apiUrl from window.__INSPECTOR_API_URL__.
 * In standalone mode, uses relative URLs (current origin).
 *
 * @param path - The API path (e.g., "/inspector/api/chat")
 * @returns The full URL or relative path
 */
export function getApiUrl(path: string): string {
  // Check if we're in embedded mode with custom API URL
  const customApiUrl =
    typeof window !== "undefined"
      ? (window as any).__INSPECTOR_API_URL__
      : undefined;

  if (customApiUrl) {
    // Remove trailing slash from apiUrl
    const baseUrl = customApiUrl.replace(/\/$/, "");
    // Remove leading slash from path if present
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return `${baseUrl}/${cleanPath}`;
  }

  // Default: use relative URL (current origin)
  return path;
}
