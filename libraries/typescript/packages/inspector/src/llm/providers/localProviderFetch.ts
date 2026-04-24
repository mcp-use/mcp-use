function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const DEFAULT_LOCAL_PROVIDER_PROXY_PATH = "/inspector/api/proxy";

function getInjectedProxyPath(): string | null {
  if (!isBrowserEnvironment()) return null;

  const injected = (window as Window & { __MCP_PROXY_URL__?: string })
    .__MCP_PROXY_URL__;
  return typeof injected === "string" && injected.trim()
    ? injected
    : DEFAULT_LOCAL_PROVIDER_PROXY_PATH;
}

export async function fetchLocalProvider(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!isBrowserEnvironment()) {
    return fetch(url, init);
  }

  const proxyPath = getInjectedProxyPath();
  const targetUrl = new URL(url);
  const headers = new Headers(init.headers);
  headers.set("X-Target-URL", url);

  return fetch(`${proxyPath}${targetUrl.pathname}${targetUrl.search}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    signal: init.signal,
  });
}
