/** Browser-facing development asset origin and Vite HMR socket address. */
export interface DevClientEndpoint {
  origin: string;
  hmr: {
    protocol: "ws" | "wss";
    host: string;
    clientPort: number;
  };
}

function configuredOrigin(mcpUrl: string | undefined): URL | null {
  if (!mcpUrl) return null;
  try {
    const url = new URL(mcpUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/** Resolve the browser-facing Vite asset and HMR endpoint. */
export function resolveDevClientEndpoint(
  host: string,
  port: number,
  mcpUrl: string | undefined
): DevClientEndpoint {
  const loopbackOrWildcard = ["127.0.0.1", "localhost", "0.0.0.0", "::", "::1"];
  const browsableHost = loopbackOrWildcard.includes(host) ? "localhost" : host;
  const fallback = new URL(
    `http://${
      browsableHost.includes(":") ? `[${browsableHost}]` : browsableHost
    }:${port}`
  );
  const publicOrigin = configuredOrigin(mcpUrl) ?? fallback;
  const secure = publicOrigin.protocol === "https:";

  return {
    origin: publicOrigin.origin,
    hmr: {
      protocol: secure ? "wss" : "ws",
      host: publicOrigin.hostname,
      clientPort: publicOrigin.port
        ? Number(publicOrigin.port)
        : secure
          ? 443
          : 80,
    },
  };
}
