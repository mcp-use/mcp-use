// browser-provider.ts
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { sanitizeUrl } from "../utils/url-sanitize.js";
// Assuming StoredState is defined in ./types.js and includes fields for provider options
import type { StoredState } from "./types.js"; // Adjust path if necessary

/**
 * Serialize request body for proxying
 */
async function serializeBody(body: BodyInit): Promise<any> {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams || body instanceof FormData) {
    return Object.fromEntries(body.entries());
  }
  if (body instanceof Blob) return await body.text();
  return body;
}

/**
 * Browser-compatible OAuth client provider for MCP using localStorage.
 */
export class BrowserOAuthClientProvider implements OAuthClientProvider {
  readonly serverUrl: string;
  readonly storageKeyPrefix: string;
  readonly serverUrlHash: string;
  readonly clientName: string;
  readonly clientUri: string;
  readonly logoUri: string;
  readonly callbackUrl: string;
  private preventAutoAuth?: boolean;
  private useRedirectFlow?: boolean;
  private oauthProxyUrl?: string;
  private connectionUrl?: string; // MCP proxy URL that client connected to
  private originalFetch?: typeof fetch;
  readonly onPopupWindow:
    | ((
        url: string,
        features: string,
        window: globalThis.Window | null
      ) => void)
    | undefined;

  constructor(
    serverUrl: string,
    options: {
      storageKeyPrefix?: string;
      clientName?: string;
      clientUri?: string;
      logoUri?: string;
      callbackUrl?: string;
      preventAutoAuth?: boolean;
      useRedirectFlow?: boolean;
      oauthProxyUrl?: string;
      connectionUrl?: string; // MCP proxy URL that client connected to (for resource field rewriting)
      onPopupWindow?: (
        url: string,
        features: string,
        window: globalThis.Window | null
      ) => void;
    } = {}
  ) {
    this.serverUrl = serverUrl;
    this.storageKeyPrefix = options.storageKeyPrefix || "mcp:auth";
    this.serverUrlHash = this.hashString(serverUrl);
    this.clientName = options.clientName || "mcp-use";
    this.clientUri =
      options.clientUri ||
      (typeof window !== "undefined" ? window.location.origin : "");
    this.logoUri = options.logoUri || "https://mcp-use.com/logo.png";
    this.callbackUrl = sanitizeUrl(
      options.callbackUrl ||
        (typeof window !== "undefined"
          ? new URL("/oauth/callback", window.location.origin).toString()
          : "/oauth/callback")
    );
    this.preventAutoAuth = options.preventAutoAuth;
    this.useRedirectFlow = options.useRedirectFlow;
    this.oauthProxyUrl = options.oauthProxyUrl;
    this.connectionUrl = options.connectionUrl;
    this.onPopupWindow = options.onPopupWindow;
  }

  /**
   * Install fetch interceptor to proxy OAuth requests through the backend
   */
  installFetchInterceptor(): void {
    if (!this.oauthProxyUrl) {
      console.warn(
        "[BrowserOAuthProvider] No OAuth proxy URL configured, skipping fetch interceptor installation"
      );
      return; // No proxy configured
    }

    // Store original fetch if not already stored
    if (!this.originalFetch) {
      this.originalFetch = window.fetch;
    } else {
      console.warn(
        "[BrowserOAuthProvider] Fetch interceptor already installed"
      );
      return; // Already installed
    }

    const oauthProxyUrl = this.oauthProxyUrl;
    const connectionUrl = this.connectionUrl; // Capture connectionUrl in closure
    const serverUrl = this.serverUrl; // Capture serverUrl for WWW-Authenticate discovery
    const originalFetch = this.originalFetch;

    console.log(
      `[BrowserOAuthProvider] Installing fetch interceptor with proxy: ${oauthProxyUrl}`
    );

    // Create interceptor
    window.fetch = async function interceptedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      // Check if this is an OAuth-related request that needs CORS bypass
      const isOAuthRequest =
        url.includes("/.well-known/") ||
        url.match(/\/(register|token|authorize)$/);

      if (!isOAuthRequest) {
        return await originalFetch(input, init);
      }

      // Don't intercept requests already going to our OAuth proxy (avoid circular proxying)
      // Check if the URL is pointing to our OAuth proxy endpoint
      try {
        const urlObj = new URL(url);
        const proxyUrlObj = new URL(oauthProxyUrl);
        // If the request is going to the same origin and path as our OAuth proxy, don't intercept
        if (
          urlObj.origin === proxyUrlObj.origin &&
          (urlObj.pathname.startsWith(proxyUrlObj.pathname) ||
            url.includes("/inspector/api/oauth"))
        ) {
          return await originalFetch(input, init);
        }
      } catch {
        // If URL parsing fails, continue with interception (better safe than sorry)
      }

      // Proxy OAuth requests through our server
      // The URL here should be the original OAuth server URL (e.g., https://mcp.vercel.com/.well-known/...)
      try {
        const isMetadata = url.includes("/.well-known/");

        // IMPORTANT: When using a gateway/proxy, the SDK's OAuth client may construct
        // metadata URLs using the gateway URL instead of the actual server URL.
        // We need to detect and rewrite these to use the actual server URL.
        let metadataUrl = url;
        if (isMetadata && serverUrl) {
          try {
            const urlObj = new URL(url);
            const serverUrlObj = new URL(serverUrl);

            // Check if the URL is using a non-https scheme (like http://localhost)
            // which indicates it's using the gateway URL instead of the actual server
            if (
              urlObj.protocol === "http:" &&
              serverUrlObj.protocol === "https:"
            ) {
              // This is likely a gateway URL, replace with server URL
              // Extract just the .well-known path (without any proxy path that may have been appended)
              const pathMatch = urlObj.pathname.match(/(\/.well-known\/[^/]+)/);
              const wellKnownPath = pathMatch ? pathMatch[1] : urlObj.pathname;
              metadataUrl = `${serverUrlObj.origin}${wellKnownPath}`;
              console.log(
                `[OAuth Proxy] Rewrote gateway metadata URL ${url} to server URL ${metadataUrl}`
              );
            } else if (connectionUrl) {
              // Also check if the URL origin matches the connection/gateway origin
              const connectionUrlObj = new URL(connectionUrl);
              if (
                urlObj.origin === connectionUrlObj.origin &&
                urlObj.origin !== serverUrlObj.origin
              ) {
                // Using gateway origin, rewrite to server origin
                // Extract just the .well-known path
                const pathMatch = urlObj.pathname.match(
                  /(\/.well-known\/[^/]+)/
                );
                const wellKnownPath = pathMatch
                  ? pathMatch[1]
                  : urlObj.pathname;
                metadataUrl = `${serverUrlObj.origin}${wellKnownPath}`;
                console.log(
                  `[OAuth Proxy] Rewrote gateway metadata URL ${url} to server URL ${metadataUrl}`
                );
              }
            }
          } catch (e) {
            console.error(`[OAuth Proxy] Error rewriting metadata URL:`, e);
          }
        }

        const proxyEndpoint = isMetadata
          ? `${oauthProxyUrl}/metadata?url=${encodeURIComponent(metadataUrl)}`
          : `${oauthProxyUrl}/proxy`;

        console.log(
          `[OAuth Proxy] Routing ${isMetadata ? "metadata" : "request"} through: ${proxyEndpoint}`
        );

        if (isMetadata) {
          // Metadata requests: simple GET through proxy
          // Include connection URL header so OAuth proxy can rewrite resource field
          // Also include the MCP server URL for WWW-Authenticate header discovery
          const headers: Record<string, string> = {
            ...(init?.headers
              ? Object.fromEntries(new Headers(init.headers as HeadersInit))
              : {}),
          };
          if (connectionUrl) {
            headers["X-Connection-URL"] = connectionUrl;
          }

          // Construct proxy URL with both the metadata URL and the original MCP URL
          const proxyUrl = new URL(proxyEndpoint);
          // Add the original MCP server URL so proxy can discover metadata from WWW-Authenticate
          if (serverUrl) {
            proxyUrl.searchParams.set("mcp_url", serverUrl);
          }

          return await originalFetch(proxyUrl.toString(), {
            ...init,
            method: "GET",
            headers,
          });
        }

        // OAuth endpoint requests: serialize and proxy the full request
        // IMPORTANT: For authorize requests, rewrite the resource parameter to use the actual server URL
        // The metadata proxy stores the original resource in _original_resource for this purpose
        let requestUrl = url;
        if (url.includes("/authorize") && serverUrl) {
          try {
            const urlObj = new URL(url);
            const resourceParam = urlObj.searchParams.get("resource");

            // If resource parameter exists, rewrite it to the actual server URL
            // (it was temporarily set to gateway URL to pass SDK validation)
            if (resourceParam && connectionUrl) {
              const connectionUrlObj = new URL(connectionUrl);

              // Check if resource is using the gateway URL (which SDK required for validation)
              if (
                resourceParam.startsWith(connectionUrlObj.origin) ||
                resourceParam === connectionUrl
              ) {
                // Replace with the actual server URL for Supabase OAuth validation
                urlObj.searchParams.set("resource", serverUrl);
                requestUrl = urlObj.toString();
                console.log(
                  `[OAuth Proxy] Rewrote authorize resource parameter from ${resourceParam} to ${serverUrl}`
                );
              }
            }
          } catch (e) {
            console.error(`[OAuth Proxy] Error rewriting authorize URL:`, e);
          }
        }

        let body = init?.body ? await serializeBody(init.body) : undefined;

        // IMPORTANT: For token requests, rewrite the resource parameter in the body
        // The body is URL-encoded form data, and resource needs to be the actual server URL
        if (url.includes("/token") && serverUrl && connectionUrl && body) {
          try {
            // Body is URL-encoded form data string
            const params = new URLSearchParams(body);
            const resourceParam = params.get("resource");

            if (resourceParam) {
              const connectionUrlObj = new URL(connectionUrl);

              // Check if resource is using the gateway URL
              if (
                resourceParam.startsWith(connectionUrlObj.origin) ||
                resourceParam === connectionUrl
              ) {
                // Replace with the actual server URL for Supabase OAuth validation
                params.set("resource", serverUrl);
                body = params.toString();
                console.log(
                  `[OAuth Proxy] Rewrote token resource parameter from ${resourceParam} to ${serverUrl}`
                );
              }
            }
          } catch (e) {
            console.error(`[OAuth Proxy] Error rewriting token body:`, e);
          }
        }
        const response = await originalFetch(proxyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: requestUrl,
            method: init?.method || "POST",
            headers: init?.headers
              ? Object.fromEntries(new Headers(init.headers as HeadersInit))
              : {},
            body,
          }),
        });

        const data = await response.json();
        return new Response(JSON.stringify(data.body), {
          status: data.status,
          statusText: data.statusText,
          headers: new Headers(data.headers),
        });
      } catch (error) {
        console.error(
          "[OAuth Proxy] Request failed, falling back to direct fetch:",
          error
        );
        return await originalFetch(input, init);
      }
    };
  }

  /**
   * Restore original fetch after OAuth flow completes
   */
  restoreFetch(): void {
    if (this.originalFetch) {
      console.log("[BrowserOAuthProvider] Restoring original fetch");
      window.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
  }

  // --- SDK Interface Methods ---

  get redirectUrl(): string {
    return sanitizeUrl(this.callbackUrl);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none", // Public client
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: this.clientName,
      client_uri: this.clientUri,
      logo_uri: this.logoUri,
      // scope: 'openid profile email mcp', // Example scopes, adjust as needed
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const key = this.getKey("client_info");
    const data = localStorage.getItem(key);
    if (!data) return undefined;
    try {
      // TODO: Add validation using a schema
      return JSON.parse(data) as OAuthClientInformation;
    } catch (e) {
      console.warn(
        `[${this.storageKeyPrefix}] Failed to parse client information:`,
        e
      );
      localStorage.removeItem(key);
      return undefined;
    }
  }

  // NOTE: The SDK's auth() function uses this if dynamic registration is needed.
  // Ensure your OAuthClientInformationFull matches the expected structure if DCR is used.
  async saveClientInformation(
    clientInformation: OAuthClientInformation /* | OAuthClientInformationFull */
  ): Promise<void> {
    const key = this.getKey("client_info");
    // Cast needed if handling OAuthClientInformationFull specifically
    localStorage.setItem(key, JSON.stringify(clientInformation));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const key = this.getKey("tokens");
    const data = localStorage.getItem(key);
    if (!data) return undefined;
    try {
      // TODO: Add validation
      return JSON.parse(data) as OAuthTokens;
    } catch (e) {
      console.warn(`[${this.storageKeyPrefix}] Failed to parse tokens:`, e);
      localStorage.removeItem(key);
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const key = this.getKey("tokens");
    localStorage.setItem(key, JSON.stringify(tokens));
    // Clean up code verifier and last auth URL after successful token save
    localStorage.removeItem(this.getKey("code_verifier"));
    localStorage.removeItem(this.getKey("last_auth_url"));
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const key = this.getKey("code_verifier");
    localStorage.setItem(key, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const key = this.getKey("code_verifier");
    const verifier = localStorage.getItem(key);
    if (!verifier) {
      throw new Error(
        `[${this.storageKeyPrefix}] Code verifier not found in storage for key ${key}. Auth flow likely corrupted or timed out.`
      );
    }
    // SDK's auth() retrieves this BEFORE exchanging code. Don't remove it here.
    // It will be removed in saveTokens on success.
    return verifier;
  }

  /**
   * Generates and stores the authorization URL with state, without opening a popup.
   * Used when preventAutoAuth is enabled to provide the URL for manual navigation.
   * @param authorizationUrl The fully constructed authorization URL from the SDK.
   * @returns The full authorization URL with state parameter.
   */
  async prepareAuthorizationUrl(authorizationUrl: URL): Promise<string> {
    // IMPORTANT: Rewrite the resource parameter from the gateway URL back to the actual server URL
    // The metadata was modified to pass SDK validation (resource = connectionUrl),
    // but Supabase needs the actual MCP server URL
    if (this.connectionUrl && this.serverUrl) {
      const resourceParam = authorizationUrl.searchParams.get("resource");
      if (resourceParam) {
        try {
          const connectionUrlObj = new URL(this.connectionUrl);
          // Check if resource is using the gateway URL (which SDK required for validation)
          if (
            resourceParam.startsWith(connectionUrlObj.origin) ||
            resourceParam === this.connectionUrl
          ) {
            // Replace with the actual server URL for Supabase OAuth validation
            authorizationUrl.searchParams.set("resource", this.serverUrl);
            console.log(
              `[OAuth] Rewrote authorize resource parameter from ${resourceParam} to ${this.serverUrl}`
            );
          }
        } catch (e) {
          console.error(`[OAuth] Error rewriting resource parameter:`, e);
        }
      }
    }

    // Generate a unique state parameter for this authorization request
    const state = globalThis.crypto.randomUUID();
    const stateKey = `${this.storageKeyPrefix}:state_${state}`;

    // Store context needed by the callback handler, associated with the state param
    const stateData: StoredState = {
      serverUrlHash: this.serverUrlHash,
      expiry: Date.now() + 1000 * 60 * 10, // State expires in 10 minutes
      // Store provider options needed to reconstruct on callback
      providerOptions: {
        serverUrl: this.serverUrl,
        storageKeyPrefix: this.storageKeyPrefix,
        clientName: this.clientName,
        clientUri: this.clientUri,
        callbackUrl: this.callbackUrl,
        // Include OAuth proxy settings so callback can bypass CORS for token exchange
        oauthProxyUrl: this.oauthProxyUrl,
        connectionUrl: this.connectionUrl,
      },
      // Store flow type so callback knows how to handle the response
      flowType: this.useRedirectFlow ? "redirect" : "popup",
      // Always store current URL so we can return to it after auth
      // This is critical for popup flow when popup is blocked and user clicks link manually
      returnUrl:
        typeof window !== "undefined" ? window.location.href : undefined,
    };

    console.log(`[OAuth] Storing state key: ${stateKey}`);
    localStorage.setItem(stateKey, JSON.stringify(stateData));

    // Verify it was stored
    const verified = localStorage.getItem(stateKey);
    console.log(`[OAuth] State stored successfully: ${!!verified}`);

    // Add the state parameter to the URL
    authorizationUrl.searchParams.set("state", state);
    const authUrlString = authorizationUrl.toString();

    // Sanitize the authorization URL to prevent XSS attacks
    const sanitizedAuthUrl = sanitizeUrl(authUrlString);

    // Persist the exact auth URL in case the popup fails and manual navigation is needed
    localStorage.setItem(this.getKey("last_auth_url"), sanitizedAuthUrl);

    return sanitizedAuthUrl;
  }

  /**
   * Redirects the user agent to the authorization URL, storing necessary state.
   * This now adheres to the SDK's void return type expectation for the interface.
   * @param authorizationUrl The fully constructed authorization URL from the SDK.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Always prepare the authorization URL with state (stores it for manual auth)
    const sanitizedAuthUrl =
      await this.prepareAuthorizationUrl(authorizationUrl);

    // If auto-auth is prevented, just store the URL but don't redirect/popup
    if (this.preventAutoAuth) {
      console.info(
        `[${this.storageKeyPrefix}] Auto-auth prevented. Authorization URL stored for manual trigger.`
      );
      return;
    }

    // Use redirect flow if enabled (avoids popup blockers)
    if (this.useRedirectFlow) {
      console.info(
        `[${this.storageKeyPrefix}] Redirecting to authorization URL (full-page redirect).`
      );
      window.location.href = sanitizedAuthUrl;
      return;
    }

    // Otherwise, use popup flow (legacy behavior)
    const popupFeatures =
      "width=600,height=700,resizable=yes,scrollbars=yes,status=yes"; // Make configurable if needed
    try {
      const popup = window.open(
        sanitizedAuthUrl,
        `mcp_auth_${this.serverUrlHash}`,
        popupFeatures
      );

      // If a callback is provided, invoke it after opening the popup
      if (this.onPopupWindow) {
        this.onPopupWindow(sanitizedAuthUrl, popupFeatures, popup);
      }

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        console.warn(
          `[${this.storageKeyPrefix}] Popup likely blocked by browser. Manual navigation might be required using the stored URL.`
        );
        // Cannot signal failure back via SDK auth() directly.
        // useMcp will need to rely on timeout or manual trigger if stuck.
      } else {
        popup.focus();
        console.info(
          `[${this.storageKeyPrefix}] Redirecting to authorization URL in popup.`
        );
      }
    } catch (e) {
      console.error(
        `[${this.storageKeyPrefix}] Error opening popup window:`,
        e
      );
      // Cannot signal failure back via SDK auth() directly.
    }
    // Regardless of popup success, the interface expects this method to initiate the redirect.
    // If the popup failed, the user journey stops here until manual action or timeout.
  }

  // --- Helper Methods ---

  /**
   * Retrieves the last URL passed to `redirectToAuthorization`. Useful for manual fallback.
   */
  getLastAttemptedAuthUrl(): string | null {
    const storedUrl = localStorage.getItem(this.getKey("last_auth_url"));
    return storedUrl ? sanitizeUrl(storedUrl) : null;
  }

  clearStorage(): number {
    const prefixPattern = `${this.storageKeyPrefix}_${this.serverUrlHash}_`;
    const statePattern = `${this.storageKeyPrefix}:state_`;
    const keysToRemove: string[] = [];
    let count = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(prefixPattern)) {
        keysToRemove.push(key);
      } else if (key.startsWith(statePattern)) {
        try {
          const item = localStorage.getItem(key);
          if (item) {
            // Check if state belongs to this provider instance based on serverUrlHash
            // We need to parse cautiously as the structure isn't guaranteed.
            const state = JSON.parse(item) as Partial<StoredState>;
            if (state.serverUrlHash === this.serverUrlHash) {
              keysToRemove.push(key);
            }
          }
        } catch (e) {
          console.warn(
            `[${this.storageKeyPrefix}] Error parsing state key ${key} during clearStorage:`,
            e
          );
          // Optionally remove malformed keys
          // keysToRemove.push(key);
        }
      }
    }

    const uniqueKeysToRemove = [...new Set(keysToRemove)];
    uniqueKeysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      count++;
    });
    return count;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  getKey(keySuffix: string): string {
    return `${this.storageKeyPrefix}_${this.serverUrlHash}_${keySuffix}`;
  }
}
