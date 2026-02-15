import { BrowserOAuthClientProvider } from "../auth/browser-provider.js";

export const USE_MCP_SERVER_NAME = "inspector-server";

export type OAuthClientConfig = {
  name?: string;
  version?: string;
  uri?: string;
  logo_uri?: string;
};

export function deriveOAuthClientConfigFromClientInfo(clientInfo: {
  name: string;
  title?: string;
  version: string;
  description?: string;
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
  }>;
  websiteUrl?: string;
}): OAuthClientConfig {
  return {
    name: clientInfo.name,
    version: clientInfo.version,
    uri: clientInfo.websiteUrl,
    logo_uri: clientInfo.icons?.[0]?.src,
  };
}

export function isOAuthDiscoveryFailure(error: Error | unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const msg = errorMessage.toLowerCase();

  return (
    msg.includes("oauth discovery failed") ||
    msg.includes("oauth-authorization-server") ||
    msg.includes("not valid json") ||
    (msg.includes("404") &&
      (msg.includes("openid-configuration") ||
        msg.includes("oauth-protected-resources") ||
        msg.includes("oauth-authorization-url") ||
        msg.includes("register"))) ||
    (msg.includes("invalid oauth error response") && msg.includes("not found"))
  );
}

export function deriveOAuthProxyUrl(gatewayUrl?: string): string | undefined {
  if (!gatewayUrl) {
    return undefined;
  }
  const gatewayUrlObj = new URL(gatewayUrl);
  const basePath = gatewayUrlObj.pathname.replace(/\/proxy\/?$/, "");
  return `${gatewayUrlObj.origin}${basePath}/oauth`;
}

export function createBrowserOAuthProvider(params: {
  effectiveOAuthUrl: string;
  storageKeyPrefix: string;
  oauthClientConfig: OAuthClientConfig;
  callbackUrl: string;
  preventAutoAuth: boolean;
  useRedirectFlow: boolean;
  gatewayUrl?: string;
  onPopupWindow?: (
    url: string,
    features: string,
    window: globalThis.Window | null
  ) => void;
  installFetchInterceptor: boolean;
}): {
  provider: BrowserOAuthClientProvider;
  oauthProxyUrl?: string;
} {
  const oauthProxyUrl = deriveOAuthProxyUrl(params.gatewayUrl);
  const provider = new BrowserOAuthClientProvider(params.effectiveOAuthUrl, {
    storageKeyPrefix: params.storageKeyPrefix,
    clientName: params.oauthClientConfig.name,
    clientUri: params.oauthClientConfig.uri,
    logoUri:
      params.oauthClientConfig.logo_uri || "https://mcp-use.com/logo.png",
    callbackUrl: params.callbackUrl,
    preventAutoAuth: params.preventAutoAuth,
    useRedirectFlow: params.useRedirectFlow,
    oauthProxyUrl,
    connectionUrl: params.gatewayUrl,
    onPopupWindow: params.onPopupWindow,
  });

  if (oauthProxyUrl && params.installFetchInterceptor) {
    provider.installFetchInterceptor();
  }

  return { provider, oauthProxyUrl };
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function startConnectionHealthMonitoring(params: {
  gatewayUrl?: string;
  url?: string;
  allHeaders?: Record<string, string>;
  isMountedRef: { current: boolean };
  stateRef: { current: string };
  autoReconnectRef: { current: boolean | number };
  setState: (state: "discovering") => void;
  addLog: (level: LogLevel, message: string, ...args: unknown[]) => void;
  connect: () => void;
  defaultReconnectDelay: number;
  healthCheckIntervalMs?: number;
  healthCheckTimeoutMs?: number;
}): () => void {
  let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  let lastSuccessfulCheck = Date.now();
  const healthCheckIntervalMs = params.healthCheckIntervalMs ?? 10000;
  const healthCheckTimeoutMs = params.healthCheckTimeoutMs ?? 30000;

  const checkConnectionHealth = async () => {
    if (!params.isMountedRef.current || params.stateRef.current !== "ready") {
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }
      return;
    }

    try {
      const healthCheckUrl = params.gatewayUrl || params.url;
      if (!healthCheckUrl) {
        return;
      }

      const response = await fetch(healthCheckUrl, {
        method: "HEAD",
        headers: params.allHeaders,
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok || response.status < 500) {
        lastSuccessfulCheck = Date.now();
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch {
      const timeSinceLastSuccess = Date.now() - lastSuccessfulCheck;
      if (timeSinceLastSuccess > healthCheckTimeoutMs) {
        params.addLog(
          "warn",
          `Connection appears to be broken (no response for ${Math.round(timeSinceLastSuccess / 1000)}s), attempting to reconnect...`
        );

        if (healthCheckInterval) {
          clearInterval(healthCheckInterval);
          healthCheckInterval = null;
        }

        if (params.autoReconnectRef.current && params.isMountedRef.current) {
          params.setState("discovering");
          params.addLog("info", "Auto-reconnecting to MCP server...");

          setTimeout(
            () => {
              if (
                params.isMountedRef.current &&
                params.stateRef.current === "discovering"
              ) {
                params.connect();
              }
            },
            typeof params.autoReconnectRef.current === "number"
              ? params.autoReconnectRef.current
              : params.defaultReconnectDelay
          );
        }
      }
    }
  };

  healthCheckInterval = setInterval(
    checkConnectionHealth,
    healthCheckIntervalMs
  );
  return () => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  };
}
