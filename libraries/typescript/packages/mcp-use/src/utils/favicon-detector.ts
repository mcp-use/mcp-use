/**
 * Favicon detection utilities for MCP servers
 * @module favicon-detector
 */

/**
 * Determine whether a domain refers to a local or private server.
 *
 * @param domain - Hostname or IPv4 address to evaluate
 * @returns `true` if `domain` is `localhost` or belongs to common private/loopback IPv4 ranges (`127.*`, `10.*`, `192.168.*`, `172.*`), `false` otherwise
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
 * Returns the base domain composed of the last two hostname labels (e.g., "api.github.com" → "github.com").
 *
 * @param hostname - Full hostname to extract the base domain from
 * @returns The base domain consisting of the last two labels, or the original `hostname` if it has two or fewer labels
 */
function getBaseDomain(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(parts.length - 2).join(".");
}

/**
 * Convert a Blob into a base64-encoded data URL.
 *
 * @returns A string containing a base64 data URL representing the Blob's contents
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
 * Detects and retrieves the favicon for an MCP server.
 *
 * Attempts the server host and its base domain (when different), skipping local/private hosts,
 * and returns the favicon as a base64 data URL if found.
 *
 * @param serverUrl - The MCP server URL or host (e.g., "https://mcp.linear.app/mcp" or "mcp.linear.app")
 * @returns The base64-encoded favicon data URL if detected, `null` otherwise
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
