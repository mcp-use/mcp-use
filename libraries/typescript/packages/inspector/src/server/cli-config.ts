import type { OAuthProxyConfidentialClientResolver } from "./proxy/oauth-proxy.js";

/** Parse server-only confidential-client configuration for the standalone CLI. */
export function createConfidentialClientResolver(
  value: string | undefined
): OAuthProxyConfidentialClientResolver | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON must be valid JSON"
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "INSPECTOR_OAUTH_CONFIDENTIAL_CLIENTS_JSON must be an array"
    );
  }
  const clients = parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid Inspector confidential client entry");
    }
    const record = entry as Record<string, unknown>;
    const serverUrls = record.serverUrls;
    const authorizationServers = record.authorizationServers;
    if (
      !Array.isArray(serverUrls) ||
      serverUrls.length === 0 ||
      !serverUrls.every((url): url is string => typeof url === "string") ||
      (authorizationServers !== undefined &&
        (!Array.isArray(authorizationServers) ||
          !authorizationServers.every(
            (url): url is string => typeof url === "string"
          )))
    ) {
      throw new Error("Invalid Inspector confidential client entry");
    }
    const clientId = record.clientId;
    const clientSecret = record.clientSecret;
    const authMethod = record.authMethod;
    if (
      typeof clientId !== "string" ||
      typeof clientSecret !== "string" ||
      (authMethod !== "client_secret_basic" &&
        authMethod !== "client_secret_post")
    ) {
      throw new Error("Invalid Inspector confidential client entry");
    }
    return {
      serverUrls: serverUrls.map((url) => canonicalUrl(url)),
      authorizationServers: (authorizationServers ?? []).map((url) =>
        canonicalUrl(url)
      ),
      clientId,
      clientSecret,
      authMethod: authMethod as "client_secret_basic" | "client_secret_post",
    };
  });
  return ({ serverUrl, clientId, authorizationServer }) => {
    const match = clients.find(
      (client) =>
        client.clientId === clientId &&
        client.serverUrls.some((url) => url === canonicalUrl(serverUrl)) &&
        (client.authorizationServers.length === 0 ||
          (authorizationServer !== undefined &&
            client.authorizationServers.includes(
              canonicalUrl(authorizationServer)
            )))
    );
    return match
      ? {
          clientSecret: match.clientSecret,
          authMethod: match.authMethod,
        }
      : undefined;
  };
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return url.toString().replace(/\/$/, "");
}
