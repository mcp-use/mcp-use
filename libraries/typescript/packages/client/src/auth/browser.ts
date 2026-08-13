// browser-provider.ts
import {
  extractWWWAuthenticateParams,
  type OAuthClientInformation,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import { LocalStorageKVStore } from "./storage.js";
import { OAuthSessionStore } from "./session-store.js";

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

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

/** Options for the browser implementation of the SDK `OAuthClientProvider`. */
export interface BrowserOAuthOptions {
  /** Prefix used for persisted OAuth keys. */
  storageKeyPrefix?: string;
  /** Human-readable OAuth client name. */
  clientName?: string;
  /** Public website describing the OAuth client. */
  clientUri?: string;
  /** Public OAuth client logo URL. */
  logoUri?: string;
  /** OAuth redirect URI. */
  callbackUrl?: string;
  /** Whether initial connection waits for an explicit authentication action. */
  preventAutoAuth?: boolean;
  /** Whether authorization uses a full-page redirect instead of a popup. */
  useRedirectFlow?: boolean;
  /** Same-origin proxy endpoint for OAuth HTTP requests. */
  oauthProxyUrl?: string;
  /** MCP proxy URL the transport connected to, used to re-anchor discovery. */
  connectionUrl?: string;
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
  /** Called immediately before the provider opens an authorization popup. */
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
  /** Protected MCP server URL associated with this provider. */
  readonly serverUrl: string;
  /** Pre-registered public client information, when configured. */
  readonly staticClientInfo?: OAuthClientInformation;
  private session: OAuthSessionStore;
  private readonly storage: LocalStorageKVStore;

  // Browser-only state
  /** Whether initial connection waits for explicit authentication. */
  readonly preventAutoAuth?: boolean;
  private useRedirectFlow?: boolean;
  private oauthProxyUrl?: string;
  private connectionUrl?: string;
  private proxyOAuthRequests: boolean;
  private lastAttemptedAuthUrl: string | null = null;
  private authorizationPending = false;
  /** Latest protected-resource metadata URL advertised by an MCP 401. */
  private challengedResourceMetadataUrl: string | undefined;
  /** Callback invoked immediately before an authorization popup opens. */
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
    this.storage = new LocalStorageKVStore();
    this.session = new OAuthSessionStore(
      serverUrl,
      { ...options, allowClientSecret: false },
      this.storage
    );
    this.preventAutoAuth = options.preventAutoAuth;
    this.useRedirectFlow = options.useRedirectFlow;
    this.oauthProxyUrl = options.oauthProxyUrl;
    this.connectionUrl = options.connectionUrl;
    this.proxyOAuthRequests = options.proxyOAuthRequests ?? true;
    this.staticClientInfo = options.staticClientInfo;
    this.onPopupWindow = options.onPopupWindow;
  }

  // --- Identity / key fields exposed for callback handling ---

  /** Prefix used for persisted OAuth keys. */
  get storageKeyPrefix(): string {
    return this.session.storageKeyPrefix;
  }

  /** Stable hash used to namespace storage for this server. */
  get serverUrlHash(): string {
    return this.session.serverUrlHash;
  }

  /** Human-readable OAuth client name. */
  get clientName(): string {
    return this.session.clientName;
  }

  /** Public website describing the OAuth client. */
  get clientUri(): string {
    return this.session.clientUri;
  }

  /** Public OAuth client logo URL. */
  get logoUri(): string {
    return this.session.logoUri;
  }

  /** OAuth redirect URI. */
  get callbackUrl(): string {
    return this.session.callbackUrl;
  }

  /** Space-delimited OAuth scopes requested by the client. */
  get scope(): string | undefined {
    return this.session.scope;
  }

  get clientMetadataUrl(): string | undefined {
    return this.session.clientMetadataUrl;
  }

  /**
   * Returns a provider-scoped storage key.
   *
   * @param keySuffix - Suffix identifying the stored value.
   * @returns Namespaced storage key.
   */
  getKey(keySuffix: string): string {
    return this.session.getKey(keySuffix);
  }

  /** Whether an authorization flow is awaiting completion. */
  get hasPendingFlow(): boolean {
    return this.authorizationPending;
  }

  /** Marks the current authorization flow as complete. */
  markFlowComplete(): void {
    this.authorizationPending = false;
  }

  /**
   * Re-anchor an SDK-derived OAuth discovery URL from the MCP connection
   * (proxy) origin onto the actual MCP server.
   *
   * When MCP traffic is tunneled through a gateway/inspector proxy, the SDK
   * transport derives `/.well-known/*` URLs from the URL it connected to (the
   * proxy) whenever no `resource_metadata` hint is available — the SSE
   * transport's EventSource cannot read `WWW-Authenticate`, and token refresh
   * runs without a 401 response at hand. The proxy origin serves no OAuth
   * metadata, so discovery would fail and the server would be misclassified
   * as "does not support OAuth". Rewriting reproduces what a direct
   * connection would have requested: the same well-known document, anchored
   * on the server origin, with the RFC 8414 §3.1 / RFC 9728 §3.1 path
   * insertion using the server's path instead of the proxy's.
   */
  private reanchorWellKnownUrl(url: string): string {
    if (!this.connectionUrl) return url;
    try {
      const requested = new URL(url);
      const connection = new URL(this.connectionUrl);
      if (requested.origin !== connection.origin) return url;
      if (!requested.pathname.startsWith("/.well-known/")) return url;

      const target = new URL(this.serverUrl);
      const rest = requested.pathname.slice("/.well-known/".length);
      const [doc, ...suffixParts] = rest.split("/");
      if (!doc) return url;

      const suffix = suffixParts.length ? `/${suffixParts.join("/")}` : "";
      const connectionPath = trimTrailingSlashes(connection.pathname);
      const targetPath = trimTrailingSlashes(target.pathname);
      // Path-insertion form: swap the proxy's inserted path for the server's.
      // Root form (no suffix) stays root. Unrelated suffixes are preserved.
      const newSuffix =
        suffix && suffix === connectionPath ? targetPath : suffix;

      return `${target.origin}/.well-known/${doc}${newSuffix}${requested.search}`;
    } catch {
      return url;
    }
  }

  private rememberResourceMetadataChallenge(response: Response): boolean {
    if (response.status !== 401) return false;
    const { resourceMetadataUrl } = extractWWWAuthenticateParams(response);
    if (!resourceMetadataUrl) return false;
    this.challengedResourceMetadataUrl = resourceMetadataUrl.toString();
    return true;
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
   * OAuth metadata is always fetched with `cache: "no-store"`, including in
   * direct mode. Authorization servers commonly vary CORS headers by Origin;
   * bypassing the browser HTTP cache prevents a revalidated response cached
   * for another localhost origin from poisoning discovery. When OAuth proxying
   * is disabled or no `oauthProxyUrl` is configured, all requests still go
   * directly to their original URLs.
   *
   * @param baseFetch - The fetch used for non-OAuth requests and for the
   *   underlying proxy calls. Defaults to the global `fetch`.
   */
  getProxyFetch(baseFetch?: typeof fetch): typeof fetch | undefined {
    const base: typeof fetch = baseFetch ?? globalThis.fetch.bind(globalThis);
    const oauthProxyUrl =
      this.proxyOAuthRequests && this.oauthProxyUrl
        ? this.oauthProxyUrl
        : undefined;
    const discoveredEndpoints = new Set<string>();
    let restoredDiscovery = false;

    // Create scoped fetch
    return async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const requestedUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      // The SDK derives discovery URLs from the transport URL. Re-anchor URLs
      // derived from an MCP proxy onto the actual MCP server before routing.
      const url = this.reanchorWellKnownUrl(requestedUrl);

      let pathname: string;
      try {
        pathname = new URL(url).pathname;
      } catch {
        return await base(input, init);
      }
      const isMetadata = pathname.includes("/.well-known/");

      // Metadata responses can carry Origin-specific CORS headers. Never let
      // the browser reuse or revalidate a response cached for another origin.
      // This is scoped to discovery; MCP traffic and OAuth endpoint POSTs keep
      // their caller-provided cache behavior.
      if (!oauthProxyUrl) {
        const response = await base(
          isMetadata ? url : input,
          isMetadata ? { ...init, cache: "no-store" } : init
        );
        if (!isMetadata) this.rememberResourceMetadataChallenge(response);
        return response;
      }

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
        const response = await base(input, init);
        if (this.rememberResourceMetadataChallenge(response)) {
          // Endpoints restored before the MCP request may belong to discovery
          // that the fresh challenge has just made stale. Fresh metadata will
          // repopulate this routing set as the SDK rediscovers it.
          discoveredEndpoints.clear();
        }
        return response;
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
          cache: "no-store",
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

      const inputRequest = input instanceof Request ? input : undefined;
      const method = init?.method ?? inputRequest?.method ?? "POST";
      const requestHeaders = init?.headers ?? inputRequest?.headers;
      let body: unknown;
      if (init?.body !== undefined && init.body !== null) {
        body = await serializeBody(init.body);
      } else if (inputRequest?.body && method !== "GET" && method !== "HEAD") {
        body = await inputRequest.clone().text();
      }
      const response = await base(proxyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: this.serverUrl,
          url,
          method,
          headers: requestHeaders
            ? Object.fromEntries(new Headers(requestHeaders as HeadersInit))
            : {},
          body,
        }),
      });
      const data = (await response.json()) as {
        status?: unknown;
        statusText?: unknown;
        headers?: unknown;
        body?: unknown;
      };
      if (!response.ok || typeof data.status !== "number") {
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      return new Response(JSON.stringify(data.body), {
        status: data.status,
        statusText:
          typeof data.statusText === "string" ? data.statusText : undefined,
        headers: new Headers(
          data.headers && typeof data.headers === "object"
            ? (data.headers as HeadersInit)
            : undefined
        ),
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
    this.lastAttemptedAuthUrl = null;
    this.authorizationPending = false;
    return this.session.saveTokens(tokens, ctx);
  }

  /**
   * Returns the configured or dynamically registered OAuth client information.
   *
   * @param ctx - Optional registration context.
   * @returns OAuth client information, or `undefined` when not registered.
   */
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

  /**
   * Persists public OAuth client registration information.
   *
   * Static client configuration takes precedence, and browser providers discard
   * any client secret returned for a public client.
   *
   * @param clientInformation - Registration information to save.
   * @param ctx - Optional registration context.
   */
  async saveClientInformation(
    clientInformation: OAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    // When a pre-registered client_id is configured, never persist DCR results
    // — the static client_id is the source of truth.
    if (this.staticClientInfo) return;

    // Browser clients always register as public clients
    // (`token_endpoint_auth_method: "none"`). Some authorization servers,
    // including Auth0 DCR, still include a generated client_secret in the
    // registration response even though the public client must not use or
    // retain it. Persist only the public portion of the response. Keep the
    // session store's secret rejection intact as a defense-in-depth guard for
    // every other browser persistence path.
    const { client_secret: discardedClientSecret, ...publicClientInformation } =
      clientInformation;
    if (discardedClientSecret) {
      console.info(
        `[${this.storageKeyPrefix}] Discarded client_secret returned for a public browser OAuth client.`
      );
    }
    return this.session.saveClientInformation(
      publicClientInformation as OAuthClientInformation,
      ctx
    );
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
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const state = await this.session.discoveryState();
    const challengedUrl = this.challengedResourceMetadataUrl;
    this.challengedResourceMetadataUrl = undefined;

    if (challengedUrl && state) {
      // A fresh MCP challenge is authoritative. RFC 9728 section 5.2 says it
      // can indicate that protected-resource metadata has changed even when
      // the metadata URL itself is unchanged. Always rediscover after such a
      // challenge instead of trusting a complete-but-stale persisted document.
      // Let the SDK rediscover from the challenge while preserving issuer-keyed
      // tokens and client registrations until normal issuer validation decides
      // whether either credential is reusable.
      await this.session.invalidateCredentials("discovery");
      return undefined;
    }

    return state;
  }

  /**
   * Return the token endpoint from the SDK's persisted discovery state.
   * Returns `null` before a successful authorization discovery.
   */
  getTokenEndpoint(): Promise<string | null> {
    return this.session.getTokenEndpoint();
  }

  /** Return the protected-resource URL selected during OAuth discovery. */
  getResource(): Promise<string | null> {
    return this.session.getResource();
  }

  /**
   * Return the stored public OAuth client ID. Browser providers do not retain
   * client secrets.
   */
  async getClientCredentials(): Promise<{
    /** Public OAuth client identifier. */
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
    const prepared = await this.session.storeAuthorizationState(
      authorizationUrl,
      {
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
      }
    );
    this.lastAttemptedAuthUrl = prepared;
    this.authorizationPending = true;
    return prepared;
  }

  /**
   * Redirects the user agent to the authorization URL, storing necessary state.
   * @param authorizationUrl - The fully constructed authorization URL from the SDK.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.prepareAuthorizationUrl(authorizationUrl);

    // If auto-auth is prevented, just store the URL but don't redirect/popup
    if (this.preventAutoAuth) {
      console.info(
        `[${this.storageKeyPrefix}] Auto-auth prevented. Authorization URL stored for manual trigger.`
      );
      return;
    }

    this.startAuthorization();
  }

  /**
   * Open the authorization URL prepared by the official SDK.
   *
   * This is the explicit-user-action counterpart to `preventAutoAuth`: the
   * provider still lets the SDK own discovery and PKCE state, while a host can
   * launch the stored authorization request later from an Authenticate button.
   */
  startAuthorization(): void {
    const authorizationUrl = this.lastAttemptedAuthUrl;
    if (!authorizationUrl) {
      throw new Error("No prepared OAuth authorization is available");
    }

    // Use redirect flow if enabled (avoids popup blockers)
    if (this.useRedirectFlow) {
      console.info(
        `[${this.storageKeyPrefix}] Redirecting to authorization URL (full-page redirect).`
      );
      window.location.href = authorizationUrl;
      return;
    }

    // Otherwise, use popup flow (legacy behavior)
    const popupFeatures =
      "width=600,height=700,resizable=yes,scrollbars=yes,status=yes";
    try {
      const popup = window.open(
        authorizationUrl,
        `mcp_auth_${this.serverUrlHash}`,
        popupFeatures
      );

      if (this.onPopupWindow) {
        this.onPopupWindow(authorizationUrl, popupFeatures, popup);
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
    return this.lastAttemptedAuthUrl;
  }

  /**
   * Removes OAuth state stored for this server.
   *
   * @returns The number of storage entries removed.
   */
  clearStorage(): number {
    this.lastAttemptedAuthUrl = null;
    this.authorizationPending = false;
    const prefixPattern = `${this.storageKeyPrefix}_${this.serverUrlHash}_`;
    const keysToRemove: string[] = [];
    let count = 0;

    for (const key of this.storage.keys()) {
      if (key.startsWith(prefixPattern)) {
        keysToRemove.push(key);
      }
    }

    const uniqueKeysToRemove = [...new Set(keysToRemove)];
    uniqueKeysToRemove.forEach((key) => {
      this.storage.remove(key);
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
