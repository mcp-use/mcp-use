const FAVICON_API = "https://favicon.tools.mcp-use.com";

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function parseHostname(serverUrl: string): string | null {
  try {
    const raw = serverUrl.includes("://") ? serverUrl : `https://${serverUrl}`;
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "host.docker.internal" || h === "0.0.0.0") return true;
  if (!IPV4_RE.test(h)) return false;

  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;

  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const second = Number.parseInt(m[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
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
        const img = await fetch(imageUrl, { signal: AbortSignal.timeout(2000) });
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
