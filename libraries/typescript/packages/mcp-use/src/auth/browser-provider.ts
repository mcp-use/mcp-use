// browser-provider.ts
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from "@modelcontextprotocol/sdk/shared/auth-utils.js";
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

interface BrowserOAuthOptions {
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
   * When true (default), OAuth requests (.well-known metadata, token,
   * register, authorize) are routed through `oauthProxyUrl` to bypass CORS.
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
  private preventAutoAuth?: boolean;
  private useRedirectFlow?: boolean;
  private oauthProxyUrl?: string;
  private connectionUrl?: string;
  private proxyOAuthRequests: boolean;
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

  getKey(keySuffix: string): string {
    return this.session.getKey(keySuffix);
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
      const connectionPath = connection.pathname.replace(/\/+$/, "");
      const targetPath = target.pathname.replace(/\/+$/, "");
      // Path-insertion form: swap the proxy's inserted path for the server's.
      // Root form (no suffix) stays root. Unrelated suffixes are preserved.
      const newSuffix =
        suffix && suffix === connectionPath ? targetPath : suffix;

      return `${target.origin}/.well-known/${doc}${newSuffix}${requested.search}`;
    } catch {
      return url;
    }
  }

  /**
   * Returns a `fetch` function, scoped to this provider, that routes OAuth
   * requests (`.well-known` metadata, token, register, authorize) through the
   * configured `oauthProxyUrl` to bypass CORS. All other requests are passed
   * through to `baseFetch` unchanged.
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
    const connectionUrl = this.connectionUrl; // Capture connectionUrl in closure
    const serverUrl = this.serverUrl; // Capture serverUrl for WWW-Authenticate discovery

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

      // SDK discovery derives .well-known URLs from the transport URL; when MCP
      // is tunneled through a proxy that is the proxy origin. Re-anchor those
      // onto the real MCP server before deciding how to route the request.
      const url = this.reanchorWellKnownUrl(requestedUrl);

      // Check if this is an OAuth-related request that needs CORS bypass
      const isOAuthRequest =
        url.includes("/.well-known/") ||
        url.match(/\/(register|token|authorize)$/);

      if (!isOAuthRequest) {
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

          const metadataResponse = await base(proxyUrl.toString(), {
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
        const response = await base(proxyEndpoint, {
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
        // Fall back to the re-anchored URL — a direct fetch to the proxy
        // origin would never serve OAuth metadata.
        return url !== requestedUrl
          ? await base(url, init)
          : await base(input, init);
      }
    };
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
   * Validate the protected resource discovered through the OAuth proxy.
   *
   * The proxy rewrites protected-resource metadata to the MCP connection URL
   * so transport-anchored discovery remains valid. Manual authentication is
   * anchored on the upstream MCP URL instead, so accept that rewrite and
   * return the original upstream resource that the authorization server
   * protects.
   */
  async validateResourceURL(
    serverUrl: string | URL,
    resource?: string
  ): Promise<URL | undefined> {
    if (!resource) return undefined;

    const requestedResource = resourceUrlFromServerUrl(serverUrl);
    if (
      checkResourceAllowed({
        requestedResource,
        configuredResource: resource,
      })
    ) {
      return new URL(resource);
    }

    const isConnectionResource =
      this.connectionUrl &&
      checkResourceAllowed({
        requestedResource: resourceUrlFromServerUrl(this.connectionUrl),
        configuredResource: resource,
      });

    if (isConnectionResource) {
      const upstreamResource = resourceUrlFromServerUrl(
        this._lastOriginalResource ?? this.serverUrl
      );

      // `_original_resource` comes from a proxied response. Never return it
      // unless it is also valid for the upstream MCP URL supplied to auth().
      if (
        checkResourceAllowed({
          requestedResource,
          configuredResource: upstreamResource,
        })
      ) {
        return upstreamResource;
      }
    }

    throw new Error(
      `Protected resource ${resource} does not match expected ${requestedResource} (or origin)`
    );
  }

  /**
   * Resolve this server's OAuth token endpoint (via discovery, cached). Lets
   * consumers persist the endpoint alongside the tokens for server-side
   * proactive refresh. Returns `null` when unavailable.
   */
  getTokenEndpoint(): Promise<string | null> {
    return this.session.getTokenEndpoint();
  }

  /** Return the canonical protected-resource URL for server-side refresh. */
  getResource(): Promise<string | null> {
    return this.session.getResource();
  }

  /**
   * Return the stored OAuth client credentials (DCR or static). Lets consumers
   * persist the `client_id`/`client_secret` for server-side refresh. Returns
   * `null` when unavailable.
   */
  getClientCredentials(): Promise<{
    client_id: string;
    client_secret?: string;
  } | null> {
    return this.session.getClientCredentials();
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
