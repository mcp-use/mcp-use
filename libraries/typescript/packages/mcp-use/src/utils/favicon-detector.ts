/**
 * Favicon detection utilities for MCP servers
 * @module favicon-detector
 */

/**
 * Check if a domain is a local/private server
 * @param domain - The domain to check
 * @returns true if the domain is localhost or a private IP
 */
export function isLocalServer(domain: string): boolean {
  return (
    domain === "localhost" ||
    domain === "127.0.0.1" ||
    domain.startsWith("127.") ||
    domain.startsWith("192.168.") ||
    domain.startsWith("10.") ||
    domain.startsWith("172.")
  );
}

/**
 * Extract base domain from a hostname (e.g., "api.github.com" → "github.com")
 * @param hostname - The full hostname
 * @returns The base domain
 */
function getBaseDomain(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(parts.length - 2).join(".");
}

/**
 * Convert blob to base64 data URL
 * @param blob - The blob to convert
 * @returns Promise with base64 data URL
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Detect and fetch favicon for a server URL
 *
 * This function:
 * 1. Extracts the domain from the server URL
 * 2. Skips local/private servers
 * 3. Tries favicon.tools.mcp-use.com API with fallbacks
 * 4. Converts the favicon to base64 for storage
 *
 * @param serverUrl - The MCP server URL (e.g., "https://mcp.linear.app/mcp")
 * @returns Promise with base64-encoded favicon data URL or null if not found
 *
 * @example
 * ```typescript
 * const favicon = await detectFavicon("https://mcp.linear.app/mcp");
 * // Returns: "data:image/png;base64,iVBORw0KGgo..."
 * // Or null if detection fails
 * ```
 */
export async function detectFavicon(serverUrl: string): Promise<string | null> {
  try {
    // Extract domain from serverUrl
    let domain: string;
    if (serverUrl.startsWith("http://") || serverUrl.startsWith("https://")) {
      domain = new URL(serverUrl).hostname;
    } else if (serverUrl.includes("://")) {
      domain = serverUrl.split("://")[1].split("/")[0];
    } else {
      domain = serverUrl.split("/")[0];
    }

    // Skip local servers - they typically don't have public favicons
    if (isLocalServer(domain)) {
      return null;
    }

    // Try full domain first, then base domain as fallback
    const baseDomain = getBaseDomain(domain);
    const domainsToTry =
      domain !== baseDomain ? [domain, baseDomain] : [domain];

    for (const currentDomain of domainsToTry) {
      try {
        // Use favicon.tools.mcp-use.com API to get the favicon as base64
        // Request the image directly (not JSON) so we get the actual image bytes
        const faviconApiUrl = `https://favicon.tools.mcp-use.com/${currentDomain}`;

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        try {
          const response = await fetch(faviconApiUrl, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            continue;
          }

          // Convert the response to base64 directly (no CORS issues since we're fetching from favicon.tools)
          const blob = await response.blob();
          const base64Image = await blobToBase64(blob);

          return base64Image;
        } catch (err) {
          clearTimeout(timeoutId);
          // Timeout or fetch error - try next domain
          continue;
        }
      } catch (error) {
        // Error with this domain - try next one
        continue;
      }
    }

    // All attempts failed
    return null;
  } catch (error) {
    console.warn("[favicon-detector] Error detecting favicon:", error);
    return null;
  }
}
