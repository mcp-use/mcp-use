import {
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { sanitizeUrl } from "../utils/url-sanitize.js";
import type { KVStore } from "./kv-store.js";
import type { StoredState } from "./types.js";

/**
 * Common options for OAuthSessionStore.
 *
 * @internal
 */
export interface OAuthSessionStoreOptions {
  storageKeyPrefix?: string;
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  callbackUrl?: string;
  /** OAuth scope string forwarded to the SDK via clientMetadata.scope. */
  scope?: string;
}

/**
 * Options passed by the platform provider when persisting an authorization
 * request prior to redirecting the user agent.
 *
 * @internal
 */
export interface StoreAuthorizationStateOptions {
  /**
   * Platform-specific provider options that should round-trip through the
   * stored state so the callback handler can rebuild the provider.
   */
  extraProviderOptions?: Record<string, unknown>;
  flowType?: "popup" | "redirect";
  returnUrl?: string;
}

/**
 * Platform-neutral helper that owns OAuth session persistence and refresh
 * logic. Used by both `BrowserOAuthClientProvider` and (future) Node/CLI
 * providers — each platform provider implements `OAuthClientProvider`
 * directly and delegates the generic methods here.
 *
 * @internal
 */
export class OAuthSessionStore {
  readonly serverUrl: string;
  readonly storageKeyPrefix: string;
  readonly serverUrlHash: string;
  readonly clientName: string;
  readonly clientUri: string;
  readonly logoUri: string;
  readonly callbackUrl: string;
  readonly scope?: string;

  private store: KVStore;
  private _cachedAuthServerUrl: string | null = null;
  private _cachedMetadata: AuthorizationServerMetadata | null = null;
  private _refreshPromise: Promise<OAuthTokens | null> | null = null;

  constructor(
    serverUrl: string,
    options: OAuthSessionStoreOptions,
    store: KVStore
  ) {
    this.serverUrl = serverUrl;
    this.storageKeyPrefix = options.storageKeyPrefix || "mcp:auth";
    this.serverUrlHash = OAuthSessionStore.hashString(serverUrl);
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
    this.scope = options.scope;
    this.store = store;
  }

  getKey(keySuffix: string): string {
    return `${this.storageKeyPrefix}_${this.serverUrlHash}_${keySuffix}`;
  }

  static hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  // --- SDK Interface Methods (delegated) ---

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: this.clientName,
      client_uri: this.clientUri,
      logo_uri: this.logoUri,
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const key = this.getKey("tokens");
    const data = await this.store.get(key);
    if (!data) return undefined;
    try {
      const tokens = JSON.parse(data) as OAuthTokens;
      if (tokens.access_token && tokens.refresh_token) {
        try {
          const payload = JSON.parse(atob(tokens.access_token.split(".")[1]));
          if (payload.exp && Date.now() >= (payload.exp - 30) * 1000) {
            console.log("[tokens] Access token expiring soon, refreshing...");
            const refreshed = await this._dedupedRefresh(tokens);
            if (refreshed) {
              console.log("[tokens] Refreshed successfully");
              return refreshed;
            }
          }
        } catch {
          // Can't decode JWT, return as-is
        }
      }
      return tokens;
    } catch (e) {
      console.warn(`[${this.storageKeyPrefix}] Failed to parse tokens:`, e);
      await this.store.remove(key);
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Persist tokens BEFORE clearing the verifier / last_auth_url so a failed
    // write can't strand the auth flow with no way to recover.
    await this.store.set(this.getKey("tokens"), JSON.stringify(tokens));
    await this.store.remove(this.getKey("code_verifier"));
    await this.store.remove(this.getKey("last_auth_url"));
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const key = this.getKey("client_info");
    const data = await this.store.get(key);
    if (!data) return undefined;
    try {
      const clientInfo = JSON.parse(data) as OAuthClientInformation & {
        redirect_uris?: string[];
      };
      const storedRedirectUris = Array.isArray(clientInfo.redirect_uris)
        ? clientInfo.redirect_uris
        : [];
      // length === 0 means the server didn't include redirect_uris in the
      // registration response — skip the check rather than invalidating valid creds.
      const hasMatchingRedirect =
        storedRedirectUris.length === 0 ||
        storedRedirectUris.includes(this.redirectUrl);

      if (!hasMatchingRedirect) {
        console.info(
          `[${this.storageKeyPrefix}] Invalidating cached OAuth client info due to redirect URI mismatch.`
        );
        await this.store.remove(key);
        await this.store.remove(this.getKey("tokens"));
        await this.store.remove(this.getKey("last_auth_url"));
        return undefined;
      }

      return clientInfo;
    } catch (e) {
      console.warn(
        `[${this.storageKeyPrefix}] Failed to parse client information:`,
        e
      );
      await this.store.remove(key);
      return undefined;
    }
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation
  ): Promise<void> {
    const key = this.getKey("client_info");
    await this.store.set(key, JSON.stringify(clientInformation));
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.set(this.getKey("code_verifier"), codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const key = this.getKey("code_verifier");
    const verifier = await this.store.get(key);
    if (!verifier) {
      throw new Error(
        `[${this.storageKeyPrefix}] Code verifier not found in storage for key ${key}. Auth flow likely corrupted or timed out.`
      );
    }
    return verifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier"
  ): Promise<void> {
    switch (scope) {
      case "all":
        await this.store.remove(this.getKey("tokens"));
        await this.store.remove(this.getKey("client_info"));
        await this.store.remove(this.getKey("code_verifier"));
        await this.store.remove(this.getKey("last_auth_url"));
        break;
      case "client":
        await this.store.remove(this.getKey("client_info"));
        break;
      case "tokens":
        await this.store.remove(this.getKey("tokens"));
        break;
      case "verifier":
        await this.store.remove(this.getKey("code_verifier"));
        break;
      default:
        break;
    }
  }

  // --- Helper / non-SDK methods ---

  /**
   * Generates and persists `StoredState` for an authorization request,
   * appends the `state` query param to the URL, and persists the sanitized
   * URL to `last_auth_url` so it can be replayed on popup-blocker fallback.
   *
   * Does NOT perform any browser/proxy-specific resource rewriting — the
   * caller (platform provider) should rewrite the URL before invoking.
   *
   * @returns The sanitized authorization URL string with the `state` param appended.
   */
  async storeAuthorizationState(
    authorizationUrl: URL,
    opts: StoreAuthorizationStateOptions = {}
  ): Promise<string> {
    const state = globalThis.crypto.randomUUID();
    const stateKey = `${this.storageKeyPrefix}:state_${state}`;
    const codeVerifier = await this.store.get(this.getKey("code_verifier"));

    const stateData: StoredState = {
      serverUrlHash: this.serverUrlHash,
      expiry: Date.now() + 1000 * 60 * 10, // State expires in 10 minutes
      codeVerifier: codeVerifier || undefined,
      providerOptions: {
        serverUrl: this.serverUrl,
        storageKeyPrefix: this.storageKeyPrefix,
        clientName: this.clientName,
        clientUri: this.clientUri,
        callbackUrl: this.callbackUrl,
        ...(opts.extraProviderOptions ?? {}),
      },
      flowType: opts.flowType,
      returnUrl: opts.returnUrl,
    };

    authorizationUrl.searchParams.set("state", state);
    const sanitizedAuthUrl = sanitizeUrl(authorizationUrl.toString());

    // Persist the state record BEFORE the last_auth_url so a partial failure
    // can't leave behind an auth URL whose state has no backing record.
    await this.store.set(stateKey, JSON.stringify(stateData));
    await this.store.set(this.getKey("last_auth_url"), sanitizedAuthUrl);

    return sanitizedAuthUrl;
  }

  // --- Refresh logic ---

  private async _refresh(tokens: OAuthTokens): Promise<OAuthTokens | null> {
    try {
      if (!this._cachedAuthServerUrl || !this._cachedMetadata) {
        const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
          this.serverUrl
        );
        const authServerUrl = resourceMetadata.authorization_servers?.[0];
        if (!authServerUrl) return null;
        const metadata =
          await discoverAuthorizationServerMetadata(authServerUrl);
        if (!metadata) return null;
        this._cachedAuthServerUrl = authServerUrl;
        this._cachedMetadata = metadata as AuthorizationServerMetadata;
      }

      const clientInfo = await this.clientInformation();
      if (!clientInfo) return null;

      const newTokens = await refreshAuthorization(this._cachedAuthServerUrl, {
        metadata: this._cachedMetadata,
        clientInformation: clientInfo,
        refreshToken: tokens.refresh_token!,
      });
      await this.saveTokens(newTokens);
      return newTokens;
    } catch {
      return null;
    }
  }

  private async _dedupedRefresh(
    tokens: OAuthTokens
  ): Promise<OAuthTokens | null> {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this._refresh(tokens);
    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  /**
   * Unconditionally exchange the persisted refresh_token for a new access
   * token. Returns the new tokens on success, or `null` if no refresh_token
   * is stored or the server rejected the grant. Shares the in-process
   * coalescing window with the lazy refresh in `tokens()`.
   */
  async forceRefresh(): Promise<OAuthTokens | null> {
    const data = await this.store.get(this.getKey("tokens"));
    if (!data) return null;
    let stored: OAuthTokens;
    try {
      stored = JSON.parse(data) as OAuthTokens;
    } catch {
      return null;
    }
    if (!stored.refresh_token) return null;
    return this._dedupedRefresh(stored);
  }
}
