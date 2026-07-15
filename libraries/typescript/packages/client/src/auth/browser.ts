// browser-provider.ts
import type {
  OAuthClientInformation,
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
} from "@modelcontextprotocol/client";
import { sanitizeUrl } from "./url.js";
import { LocalStorageKVStore } from "./storage.js";
import { OAuthSessionStore, type StoredState } from "./session-store.js";

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

/** Options for the browser implementation of {@link OAuthClientProvider}. */
export interface BrowserOAuthOptions {
  storageKeyPrefix?: string;
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  callbackUrl?: string;
  preventAutoAuth?: boolean;
  useRedirectFlow?: boolean;
  oauthProxyUrl?: string;
  /** HTTPS URL serving this public client's metadata document for CIMD. */
  clientMetadataUrl?: string;
  /**
   * When true (default), OAuth requests (.well-known metadata, token,
   * registration, revocation, and introspection) are routed through
   * `oauthProxyUrl` to bypass CORS.
   * The routing is applied only to the scoped fetch returned by
   * {@link BrowserOAuthClientProvider.getProxyFetch}; it never mutates the
   * global `fetch`. Set to false to connect directly even when an OAuth proxy
   * URL is available (e.g. when the MCP gateway already proxies OAuth).
   */
  proxyOAuthRequests?: boolean;
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
  readonly preventAutoAuth?: boolean;
  private useRedirectFlow?: boolean;
  private oauthProxyUrl?: string;
  private proxyOAuthRequests: boolean;
  readonly onPopupWindow:
    | ((
        url: string,
        features: string,
        window: globalThis.Window | null
      ) => void)
    | undefined;

  constructor(serverUrl: string, options: BrowserOAuthOptions = {}) {
    if (options.staticClientInfo?.client_secret) {
      throw new Error(
        "Browser OAuth clients must be public clients; staticClientInfo.client_secret is not allowed."
      );
    }
    this.serverUrl = serverUrl;
    this.session = new OAuthSessionStore(
      serverUrl,
      { ...options, allowClientSecret: false },
      new LocalStorageKVStore()
    );
    this.preventAutoAuth = options.preventAutoAuth;
    this.useRedirectFlow = options.useRedirectFlow;
    this.oauthProxyUrl = options.oauthProxyUrl;
    this.proxyOAuthRequests = options.proxyOAuthRequests ?? true;
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

  get clientMetadataUrl(): string | undefined {
    return this.session.clientMetadataUrl;
  }

  getKey(keySuffix: string): string {
    return this.session.getKey(keySuffix);
  }

  /**
   * Returns a `fetch` function, scoped to this provider, that routes OAuth
   * metadata and non-browser OAuth endpoint requests through the configured
   * `oauthProxyUrl` to bypass CORS. Authorization endpoints are navigated by
   * the browser and all unrelated requests pass through unchanged.
   *
   * Unlike patching the global `fetch`, the returned function only affects the
   * transport/auth calls it is explicitly handed to (via the SDK transport's
   * `fetch` option or `auth({ fetchFn })`). Connecting one server "Via Proxy"
   * therefore never alters fetch behavior for other servers, other
   * connections, or the rest of the page.
   *
   * When this provider is not configured to proxy OAuth requests (no
   * `oauthProxyUrl`, or `proxyOAuthRequests` disabled), the provided
   * `baseFetch` is returned as-is (or `undefined` when none is given, letting
   * the SDK fall back to its default `fetch`).
   *
   * @param baseFetch - The fetch used for non-OAuth requests and for the
   *   underlying proxy calls. Defaults to the global `fetch`.
   */
  getProxyFetch(baseFetch?: typeof fetch): typeof fetch | undefined {
    if (!this.proxyOAuthRequests || !this.oauthProxyUrl) {
      // Nothing to scope — return the caller's base fetch (possibly undefined).
      return baseFetch;
    }

    const base: typeof fetch = baseFetch ?? globalThis.fetch.bind(globalThis);
    const oauthProxyUrl = this.oauthProxyUrl;
    const discoveredEndpoints = new Set<string>();
    let restoredDiscovery = false;

    // Create scoped fetch
    return async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      let pathname: string;
      try {
        pathname = new URL(url).pathname;
      } catch {
        return await base(input, init);
      }
      const isMetadata = pathname.includes("/.well-known/");
      if (!restoredDiscovery) {
        restoredDiscovery = true;
        const metadata = (await this.discoveryState())
          ?.authorizationServerMetadata as Record<string, unknown> | undefined;
        for (const key of [
          "registration_endpoint",
          "token_endpoint",
          "revocation_endpoint",
          "introspection_endpoint",
        ]) {
          if (typeof metadata?.[key] === "string") {
            discoveredEndpoints.add(metadata[key]);
          }
        }
      }
      const isProxiedEndpoint =
        discoveredEndpoints.has(url) ||
        /\/(?:register|registration|token|revoke|revocation|introspect|introspection)\/?$/.test(
          pathname
        );

      if (!isMetadata && !isProxiedEndpoint) {
        return await base(input, init);
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
          return await base(input, init);
        }
      } catch {
        // If URL parsing fails, continue with interception (better safe than sorry)
      }

      const proxyEndpoint = isMetadata
        ? `${oauthProxyUrl}/metadata?serverUrl=${encodeURIComponent(
            this.serverUrl
          )}&url=${encodeURIComponent(url)}`
        : `${oauthProxyUrl}/proxy`;

      if (isMetadata) {
        const response = await base(proxyEndpoint, {
          ...init,
          method: "GET",
        });
        try {
          const metadata = (await response.clone().json()) as Record<
            string,
            unknown
          >;
          for (const key of [
            "registration_endpoint",
            "token_endpoint",
            "revocation_endpoint",
            "introspection_endpoint",
          ]) {
            if (typeof metadata[key] === "string") {
              discoveredEndpoints.add(metadata[key]);
            }
          }
        } catch {
          // The SDK owns metadata validation and will reject malformed responses.
        }
        return response;
      }

      const body = init?.body ? await serializeBody(init.body) : undefined;
      const response = await base(proxyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: this.serverUrl,
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
    };
  }

  // --- SDK Interface Methods (delegated) ---

  get redirectUrl(): string {
    return this.session.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.session.clientMetadata;
  }

  tokens(
    ctx?: OAuthClientInformationContext
  ): Promise<OAuthTokens | undefined> {
    return this.session.tokens(ctx);
  }

  saveTokens(
    tokens: OAuthTokens,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    return this.session.saveTokens(tokens, ctx);
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext
  ): Promise<OAuthClientInformation | undefined> {
    // Pre-registered client info (proxy-mode servers like Slack/WorkOS proxy
    // strip registration_endpoint, so DCR is not an option). When set, this
    // bypasses any stored DCR result so a stale localStorage entry can't
    // shadow the configured client_id.
    if (this.staticClientInfo) return this.staticClientInfo;
    return this.session.clientInformation(ctx);
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    // When a pre-registered client_id is configured, never persist DCR results
    // — the static client_id is the source of truth.
    if (this.staticClientInfo) return;
    return this.session.saveClientInformation(clientInformation, ctx);
  }

  codeVerifier(): Promise<string> {
    return this.session.codeVerifier();
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    return this.session.saveCodeVerifier(codeVerifier);
  }

  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    return this.session.invalidateCredentials(scope);
  }

  /**
   * Persist OAuth discovery state (SEP-2352). Delegated to the session store;
   * implementing this silences the SDK's per-callback warning and enables the
   * authorization-server mix-up defense on the callback leg.
   */
  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    return this.session.saveDiscoveryState(state);
  }

  /** Return previously saved OAuth discovery state, or `undefined`. */
  discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.session.discoveryState();
  }

  /**
   * Return the token endpoint from the SDK's persisted discovery state.
   * Returns `null` before a successful authorization discovery.
   */
  getTokenEndpoint(): Promise<string | null> {
    return this.session.getTokenEndpoint();
  }

  /**
   * Return the stored public OAuth client ID. Browser providers do not retain
   * client secrets.
   */
  async getClientCredentials(): Promise<{
    client_id: string;
  } | null> {
    const info = await this.clientInformation();
    return info?.client_id ? { client_id: info.client_id } : null;
  }

  /**
   * Generates and persists `StoredState` for an authorization request,
   * and returns the sanitized URL with the `state` param appended. Does NOT
   * open a popup or redirect —
   * use `redirectToAuthorization` for that.
   */
  async prepareAuthorizationUrl(authorizationUrl: URL): Promise<string> {
    return this.session.storeAuthorizationState(authorizationUrl, {
      extraProviderOptions: {
        oauthProxyUrl: this.oauthProxyUrl,
        ...(this.clientMetadataUrl
          ? { clientMetadataUrl: this.clientMetadataUrl }
          : {}),
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

/**
 * Creates the browser OAuth provider used by the root client entry.
 */
export async function createOAuthProvider(
  serverUrl: string,
  options: BrowserOAuthOptions = {}
): Promise<OAuthClientProvider> {
  return new BrowserOAuthClientProvider(serverUrl, options);
}

export type { BrowserOAuthOptions as OAuthProviderOptions };
