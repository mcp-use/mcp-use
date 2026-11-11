/** Public metadata host used by local Inspectors; it must not redirect. */
export const HOSTED_INSPECTOR_ORIGIN = "https://inspector.manufact.com";
export const OAUTH_METADATA_PATH = "/inspector/oauth/client-metadata.json";
export const LOCAL_OAUTH_METADATA_PATH =
  "/inspector/oauth/local-client-metadata";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Accept only canonical Inspector callbacks, without credentials or URL state. */
function parseCallback(value: string): URL | undefined {
  if (value.length > 1024) return;
  try {
    const url = new URL(value);
    if (
      url.href !== value ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/(?:[A-Za-z0-9._~-]+\/)*inspector\/oauth\/callback$/.test(
        url.pathname
      )
    ) {
      return;
    }
    return url;
  } catch {
    return;
  }
}

/** Local metadata is restricted to loopback, never arbitrary remote redirects. */
export function isLoopbackInspectorCallback(value: string): boolean {
  const url = parseCallback(value);
  return !!url && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Local Inspectors use the public host with an exact callback encoded in the
 * path. This works with strict redirect matching on any local port or mount
 * path, without wildcard redirects or relying on RFC 8252 port relaxation.
 * HTTPS deployments serve their own metadata beside their callback route.
 */
export function getInspectorClientMetadataUrl(
  callbackUrl: string
): string | undefined {
  const callback = parseCallback(callbackUrl);
  if (!callback) return;
  if (LOOPBACK_HOSTS.has(callback.hostname)) {
    const encoded = btoa(callbackUrl)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `${HOSTED_INSPECTOR_ORIGIN}${LOCAL_OAUTH_METADATA_PATH}/${encoded}.json`;
  }
  if (callback.protocol === "https:") {
    return callbackUrl.replace(/\/callback$/, "/client-metadata.json");
  }
}
