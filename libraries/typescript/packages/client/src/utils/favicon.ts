const FAVICON_API = "https://favicon.tools.mcp-use.com";

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-f:]+$/;

function parseHostname(serverUrl: string): string | null {
  try {
    const raw = serverUrl.includes("://") ? serverUrl : `https://${serverUrl}`;
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isPrivateIPv4(h: string): boolean {
  const [first, second] = h.split(".").map((part) => Number.parseInt(part, 10));

  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) {
    return true;
  }
  // Link-local (cloud metadata services) and carrier-grade NAT (e.g. Tailscale).
  if (first === 169 && second === 254) return true;
  if (first === 100 && second !== undefined && second >= 64 && second <= 127) {
    return true;
  }

  return false;
}

function isPrivateIPv6(h: string): boolean {
  // `URL.hostname` keeps the brackets around IPv6 literals.
  const addr = h.replace(/^\[|\]$/g, "");
  if (!IPV6_RE.test(addr)) return false;

  if (addr === "::" || addr === "::1") return true;
  // fe80::/10 link-local, fc00::/7 unique local.
  if (addr.startsWith("fe8") || addr.startsWith("fe9")) return true;
  if (addr.startsWith("fea") || addr.startsWith("feb")) return true;
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true;

  return false;
}

function isLocalHost(hostname: string): boolean {
  // A trailing dot is the DNS root form (`printer.local.`); strip it before the suffix checks.
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h === "host.docker.internal" || h === "0.0.0.0") return true;
  if (IPV4_RE.test(h)) return isPrivateIPv4(h);
  return isPrivateIPv6(h);
}

function subdomainLevels(hostname: string): string[] {
  const parts = hostname.split(".");
  return Array.from({ length: parts.length - 1 }, (_, i) =>
    parts.slice(i).join(".")
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Detect and retrieve an MCP server's favicon as a base64 data URL.
 * Skips local/private hosts; walks subdomain levels until a non-default favicon is found.
 */
export async function detectFavicon(serverUrl: string): Promise<string | null> {
  try {
    const hostname = parseHostname(serverUrl);
    if (!hostname || isLocalHost(hostname)) return null;

    for (const domain of subdomainLevels(hostname)) {
      try {
        const res = await fetch(`${FAVICON_API}/${domain}?response=json`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) continue;

        const data = (await res.json()) as { url: string; source: string };
        if (data.source === "default") continue;

        const imageUrl = data.url.replace(/^http:\/\//, "https://");
        const img = await fetch(imageUrl, {
          signal: AbortSignal.timeout(2000),
        });
        if (!img.ok) continue;

        return await blobToDataUrl(await img.blob());
      } catch {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.warn("[favicon] Error detecting favicon:", error);
    return null;
  }
}
