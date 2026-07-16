const IPV4_LOOPBACK_RE =
  /^127\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])(?:\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])){2}$/;

export function isLocalhostServerUrl(serverUrl: string): boolean {
  try {
    const u = new URL(serverUrl);
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      h === "localhost" ||
      h === "::1" ||
      h === "0.0.0.0" ||
      IPV4_LOOPBACK_RE.test(h)
    );
  } catch {
    return false;
  }
}

export function isMcpUseTunnelUrl(serverUrl: string): boolean {
  try {
    return new URL(serverUrl).hostname.endsWith(".mcp-use.run");
  } catch {
    return false;
  }
}

interface ServerNameLike {
  name?: string;
  url?: string;
  serverInfo?: {
    title?: string;
    name?: string;
  } | null;
}

export function getConfiguredServerAlias(server: ServerNameLike): string {
  const configuredName = server.name?.trim();
  const url = server.url?.trim();

  if (!configuredName) {
    return "";
  }

  return configuredName !== url ? configuredName : "";
}

export function getServerDisplayName(server: ServerNameLike): string {
  return (
    getConfiguredServerAlias(server) ||
    server.serverInfo?.title?.trim() ||
    server.serverInfo?.name?.trim() ||
    server.name?.trim() ||
    server.url?.trim() ||
    "Unknown server"
  );
}
