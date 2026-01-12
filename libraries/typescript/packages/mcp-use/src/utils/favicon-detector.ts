/**
 * Favicon detection utilities for MCP servers
 * @module favicon-detector
 */

/**
 * Response from favicon.tools.mcp-use.com API when requesting JSON format
 */
interface FaviconApiResponse {
  url: string;
  sourceUrl: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  source: "default" | "link-tag" | string;
}

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
 * Generate all subdomain levels from most specific to least specific.
 * For example: "mcp.supabase.com" → ["mcp.supabase.com", "supabase.com", "com"]
 *
 * @param hostname - Full hostname to generate subdomain levels from
 * @returns Array of domain levels from most specific to least specific
 */
function getSubdomainLevels(hostname: string): string[] {
  const parts = hostname.split(".");
  const levels: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    levels.push(parts.slice(i).join("."));
  }

  return levels;
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
  console.debug(
    "[favicon-detector] Starting favicon detection for:",
    serverUrl
  );
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
    console.debug("[favicon-detector] Extracted domain:", domain);

    // Skip local servers - they typically don't have public favicons
    if (isLocalServer(domain)) {
      console.debug("[favicon-detector] Skipping local server:", domain);
      return null;
    }

    // Get all subdomain levels to try (from most specific to least specific)
    const domainsToTry = getSubdomainLevels(domain);
    console.debug("[favicon-detector] Domains to try:", domainsToTry);

    for (const currentDomain of domainsToTry) {
      try {
        // Use favicon.tools.mcp-use.com API with JSON response to check if it's a default
        const faviconApiUrl = `https://favicon.tools.mcp-use.com/${currentDomain}?response=json`;
        console.debug(
          "[favicon-detector] Attempting to fetch favicon metadata for:",
          currentDomain,
          "from:",
          faviconApiUrl
        );

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        try {
          const response = await fetch(faviconApiUrl, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            console.debug(
              "[favicon-detector] Fetch failed for",
              currentDomain,
              "with status:",
              response.status
            );
            continue;
          }

          const data: FaviconApiResponse = await response.json();
          console.debug(
            "[favicon-detector] Retrieved favicon metadata for:",
            currentDomain,
            "source:",
            data.source
          );

          // Fetch the actual image from the URL in the response
          // Normalize http:// to https:// to avoid CORS and mixed content issues
          const imageUrl = data.url.replace(/^http:\/\//, "https://");
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) {
            console.debug(
              "[favicon-detector] Failed to fetch favicon image for",
              currentDomain,
              "status:",
              imageResponse.status
            );
            continue;
          }

          const blob = await imageResponse.blob();
          const base64Image = await blobToBase64(blob);

          if (data.source === "default") {
            // This is a default favicon, skip it and continue looking for a non-default
            console.debug(
              "[favicon-detector] Found default favicon for:",
              currentDomain,
              "skipping and continuing to search for non-default"
            );
            continue;
          }

          // Found a non-default favicon, return immediately
          console.debug(
            "[favicon-detector] Successfully retrieved non-default favicon for:",
            currentDomain,
            "source:",
            data.source,
            "size:",
            blob.size,
            "bytes"
          );
          return base64Image;
        } catch (err) {
          clearTimeout(timeoutId);
          // Timeout or fetch error - try next domain
          console.debug(
            "[favicon-detector] Fetch error for",
            currentDomain,
            ":",
            err instanceof Error ? err.message : String(err)
          );
          continue;
        }
      } catch (error) {
        // Error with this domain - try next one
        console.debug(
          "[favicon-detector] Error processing domain",
          currentDomain,
          ":",
          error instanceof Error ? error.message : String(error)
        );
        continue;
      }
    }

    // All attempts failed to find a non-default favicon
    console.debug(
      "[favicon-detector] No non-default favicon found for:",
      serverUrl,
      "returning null to show gradient fallback"
    );
    return null;
  } catch (error) {
    console.warn("[favicon-detector] Error detecting favicon:", error);
    return null;
  }
}
