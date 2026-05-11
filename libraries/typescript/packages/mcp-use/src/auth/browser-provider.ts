// browser-provider.ts
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { sanitizeUrl } from "../utils/url-sanitize.js";
import { LocalStorageKVStore } from "./kv-store.js";
import { OAuthSessionStore } from "./oauth-session-store.js";
import type { StoredState } from "./types.js";

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

export interface BrowserOAuthOptions {
  storageKeyPrefix?: string;
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  callbackUrl?: string;
  preventAutoAuth?: boolean;
  useRedirectFlow?: boolean;
  oauthProxyUrl?: string;
  /** MCP proxy URL that client connected to (for resource field rewriting) */
  connectionUrl?: string;
  /**
   * Pre-registered OAuth client information. When set, the SDK skips
   * Dynamic Client Registration and uses this client_id directly.
   * Required for proxy-mode auth servers (e.g. Slack, WorkOS proxy)
   * that strip `registration_endpoint` from metadata.
   */
  staticClientInfo?: OAuthClientInformation;
  /** OAuth scope string forwarded to the SDK via clientMetadata.scope. */
  scope?: string;
  onPopupWindow?: (
    url: string,
    features: string,
    window: globalThis.Window | null
  ) => void;
}

/**
 * Browser-compatible OAuth client provider for MCP using localStorage.
 */
export class BrowserOAuthClientProvider implements OAuthClientProvider {
  readonly serverUrl: string;
  readonly staticClientInfo?: OAuthClientInformation;
  private session: OAuthSessionStore;

  // Browser-only state
  private preventAutoAuth?: boolean;
  private useRedirectFlow?: boolean;
  private oauthProxyUrl?: string;
  private connectionUrl?: string;
  private originalFetch?: typeof fetch;
  private _lastOriginalResource: string | null = null;
  readonly onPopupWindow:
    | ((
        url: string,
        features: string,
        window: globalThis.Window | null
      ) => void)
    | undefined;

  constructor(serverUrl: string, options: BrowserOAuthOptions = {}) {
    this.serverUrl = serverUrl;
    this.session = new OAuthSessionStore(
      serverUrl,
      options,
      new LocalStorageKVStore()
    );
    this.preventAutoAuth = options.preventAutoAuth;
    this.useRedirectFlow = options.useRedirectFlow;
    this.oauthProxyUrl = options.oauthProxyUrl;
    this.connectionUrl = options.connectionUrl;
    this.staticClientInfo = options.staticClientInfo;
    this.onPopupWindow = options.onPopupWindow;
  }

  // --- Identity / key fields exposed for callback handling ---

  get storageKeyPrefix(): string {
    return this.session.storageKeyPrefix;
  }

  get serverUrlHash(): string {
    return this.session.serverUrlHash;
  }

  get clientName(): string {
    return this.session.clientName;
  }

  get clientUri(): string {
    return this.session.clientUri;
  }

  get logoUri(): string {
    return this.session.logoUri;
  }

  get callbackUrl(): string {
    return this.session.callbackUrl;
  }

  get scope(): string | undefined {
    return this.session.scope;
  }

  getKey(keySuffix: string): string {
    return this.session.getKey(keySuffix);
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
    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
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

        const proxyEndpoint = isMetadata
          ? `${oauthProxyUrl}/metadata?url=${encodeURIComponent(url)}`
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

          const metadataResponse = await originalFetch(proxyUrl.toString(), {
            ...init,
            method: "GET",
            headers,
          });
          try {
            const contentType =
              metadataResponse.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              const metadataJson = await metadataResponse.clone().json();
              const originalResource =
                metadataJson &&
                typeof metadataJson === "object" &&
                typeof metadataJson._original_resource === "string"
                  ? metadataJson._original_resource
                  : null;
              if (originalResource) {
                this._lastOriginalResource = originalResource;
              }
            }
          } catch {
            // Ignore metadata parsing errors for caching; request continues normally.
          }
          return metadataResponse;
        }

        // OAuth endpoint requests: serialize and proxy the full request unchanged.
        const body = init?.body ? await serializeBody(init.body) : undefined;
        const response = await originalFetch(proxyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
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

  // --- SDK Interface Methods (delegated) ---

  get redirectUrl(): string {
    return this.session.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.session.clientMetadata;
  }

  tokens(): Promise<OAuthTokens | undefined> {
    return this.session.tokens();
  }

  saveTokens(tokens: OAuthTokens): Promise<void> {
    return this.session.saveTokens(tokens);
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    // Pre-registered client info (proxy-mode servers like Slack/WorkOS proxy
    // strip registration_endpoint, so DCR is not an option). When set, this
    // bypasses any stored DCR result so a stale localStorage entry can't
    // shadow the configured client_id.
    if (this.staticClientInfo) return this.staticClientInfo;
    return this.session.clientInformation();
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation
  ): Promise<void> {
    // When a pre-registered client_id is configured, never persist DCR results
    // — the static client_id is the source of truth.
    if (this.staticClientInfo) return;
    return this.session.saveClientInformation(clientInformation);
  }

  codeVerifier(): Promise<string> {
    return this.session.codeVerifier();
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.session.saveCodeVerifier(codeVerifier);
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier"
  ): Promise<void> {
    return this.session.invalidateCredentials(scope);
  }

  /**
   * Generates and persists `StoredState` for an authorization request,
   * applies browser-only resource rewriting, and returns the sanitized URL
   * with the `state` param appended. Does NOT open a popup or redirect —
   * use `redirectToAuthorization` for that.
   */
  async prepareAuthorizationUrl(authorizationUrl: URL): Promise<string> {
    this.rewriteResourceIfLocalProxy(authorizationUrl);
    return this.session.storeAuthorizationState(authorizationUrl, {
      extraProviderOptions: {
        oauthProxyUrl: this.oauthProxyUrl,
        connectionUrl: this.connectionUrl,
        ...(this.staticClientInfo
          ? { staticClientInfo: this.staticClientInfo }
          : {}),
        ...(this.scope ? { scope: this.scope } : {}),
      },
      flowType: this.useRedirectFlow ? "redirect" : "popup",
      returnUrl:
        typeof window !== "undefined" ? window.location.href : undefined,
    });
  }

  /**
   * Redirects the user agent to the authorization URL, storing necessary state.
   * @param authorizationUrl The fully constructed authorization URL from the SDK.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
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
      "width=600,height=700,resizable=yes,scrollbars=yes,status=yes";
    try {
      const popup = window.open(
        sanitizedAuthUrl,
        `mcp_auth_${this.serverUrlHash}`,
        popupFeatures
      );

      if (this.onPopupWindow) {
        this.onPopupWindow(sanitizedAuthUrl, popupFeatures, popup);
      }

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        console.warn(
          `[${this.storageKeyPrefix}] Popup likely blocked by browser. Manual navigation might be required using the stored URL.`
        );
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
    }
  }

  // --- Browser-only helpers ---

  /**
   * If the SDK-built authorization URL has a `resource` parameter pointing
   * at the local inspector proxy (rather than the real MCP server), rewrite
   * it to the original resource so the OAuth server's allowlist matches.
   */
  private rewriteResourceIfLocalProxy(url: URL): void {
    const originalResourceParam = url.searchParams.get("resource");
    const looksLikeLocalProxyResource = Boolean(
      originalResourceParam &&
      (originalResourceParam.includes("/inspector/api/proxy") ||
        originalResourceParam.includes("/api/proxy") ||
        originalResourceParam.includes("localhost:3000"))
    );
    const matchesConnectionUrl = Boolean(
      originalResourceParam &&
      this.connectionUrl &&
      originalResourceParam === this.connectionUrl
    );
    const shouldRewriteResource = Boolean(
      originalResourceParam &&
      (this._lastOriginalResource || this.serverUrl) &&
      (matchesConnectionUrl || looksLikeLocalProxyResource)
    );
    const rewriteTargetResource = this._lastOriginalResource || this.serverUrl;

    if (shouldRewriteResource && rewriteTargetResource) {
      url.searchParams.set("resource", rewriteTargetResource);
    }
  }

  /**
   * Retrieves the last URL passed to `redirectToAuthorization`. Useful for manual fallback.
   */
  getLastAttemptedAuthUrl(): string | null {
    const storedUrl = localStorage.getItem(this.getKey("last_auth_url"));
    if (!storedUrl) return null;
    return sanitizeUrl(storedUrl);
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
}
