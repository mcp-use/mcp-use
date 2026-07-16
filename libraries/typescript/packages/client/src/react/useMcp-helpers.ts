import { BrowserOAuthClientProvider } from "../auth/browser.js";
import type { OAuthClientInformation } from "@modelcontextprotocol/client";
import type { MCPServerInfo } from "../core/session.js";
import { detectFavicon } from "../utils/favicon.js";

export const USE_MCP_SERVER_NAME = "inspector-server";

/** Asserts that a condition is true, throwing an error if not. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type ServerInfoWithIcon = MCPServerInfo & { icon?: string };
type AddLog = (
  level: "debug" | "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) => void;

/** Resolve a server-provided icon, then fall back to domain favicon discovery. */
export async function loadServerIcon(params: {
  serverInfo: MCPServerInfo;
  url?: string;
  isMounted: () => boolean;
  setServerInfo: (
    update: (previous?: ServerInfoWithIcon) => ServerInfoWithIcon | undefined
  ) => void;
  addLog: AddLog;
}): Promise<string | null> {
  try {
    const iconUrl = params.serverInfo.icons?.[0]?.src;
    if (iconUrl) {
      params.addLog("info", "Server provided icon:", iconUrl);
      const response = await fetch(iconUrl);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      if (params.isMounted()) {
        params.setServerInfo((previous) =>
          previous ? { ...previous, icon: base64 } : undefined
        );
        params.addLog("debug", "Server icon converted to base64");
      }
      return base64;
    }

    if (params.url) {
      const favicon = await detectFavicon(params.url);
      if (!params.isMounted()) {
        params.addLog(
          "debug",
          "Connection aborted after favicon detection - component unmounted"
        );
        return null;
      }
      if (favicon) {
        params.setServerInfo((previous) =>
          previous ? { ...previous, icon: favicon } : undefined
        );
        params.addLog("debug", "Favicon detected and added to serverInfo");
        return favicon;
      }
    }

    return null;
  } catch (error) {
    params.addLog("debug", "Icon loading failed (non-critical):", error);
    return null;
  }
}

/** Human-readable reason when MCP operations run before the client is usable. */
export function formatMcpNotReadyReason(
  state: string,
  hasClient: boolean
): string {
  return !hasClient ? `client disconnected (state=${state})` : `state=${state}`;
}

type OAuthClientConfig = {
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

/**
 * Derive the companion OAuth proxy endpoint from an MCP proxy endpoint.
 *
 * The Inspector proxy convention is `/proxy` for MCP traffic and `/oauth` for
 * OAuth metadata/token requests. An explicit OAuth URL always takes priority.
 */
export function deriveOAuthProxyUrl(
  gatewayUrl: string | undefined,
  explicitOAuthProxyUrl: string | undefined
): string | undefined {
  if (explicitOAuthProxyUrl) return explicitOAuthProxyUrl;
  if (!gatewayUrl) return undefined;

  try {
    const url = new URL(gatewayUrl);
    url.pathname = url.pathname.replace(/\/proxy\/?$/, "/oauth");
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createBrowserOAuthProvider(params: {
  effectiveOAuthUrl: string;
  storageKeyPrefix: string;
  oauthClientConfig: OAuthClientConfig;
  callbackUrl: string;
  preventAutoAuth: boolean;
  useRedirectFlow: boolean;
  /** MCP proxy URL used to derive the companion OAuth proxy when needed. */
  gatewayUrl?: string;
  /**
   * Explicit OAuth proxy base URL. Takes precedence over the URL derived from
   * `gatewayUrl`. Lets consumers proxy OAuth traffic (CORS bypass) while
   * keeping MCP traffic direct.
   */
  oauthProxyUrl?: string;
  onPopupWindow?: (
    url: string,
    features: string,
    window: globalThis.Window | null
  ) => void;
  /**
   * Whether the provider should route OAuth requests through the derived
   * OAuth proxy (to bypass CORS). The provider exposes this via its scoped
   * `getProxyFetch()` — it never patches the global `fetch`.
   */
  proxyOAuthRequests: boolean;
  staticClientInfo?: OAuthClientInformation;
  clientMetadataUrl?: string;
  scope?: string;
}): {
  provider: BrowserOAuthClientProvider;
  oauthProxyUrl?: string;
} {
  const oauthProxyUrl = deriveOAuthProxyUrl(
    params.gatewayUrl,
    params.oauthProxyUrl
  );
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
    proxyOAuthRequests: params.proxyOAuthRequests,
    staticClientInfo: params.staticClientInfo,
    clientMetadataUrl: params.clientMetadataUrl,
    scope: params.scope,
  });

  return { provider, oauthProxyUrl };
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function startConnectionHealthMonitoring(params: {
  gatewayUrl?: string;
  url?: string;
  allHeaders?: Record<string, string>;
  getAuthHeaders?: () => Promise<Record<string, string>>;
  isMountedRef: { current: boolean };
  stateRef: { current: string };
  autoReconnectRef: { current: boolean | number | Record<string, unknown> };
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

      const authHeaders = params.getAuthHeaders
        ? await params.getAuthHeaders()
        : {};
      const response = await fetch(healthCheckUrl, {
        method: "HEAD",
        headers: { ...params.allHeaders, ...authHeaders },
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
