import type {
  OAuthClientInformation,
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { validateClientMetadataUrl } from "@modelcontextprotocol/client";
import { sanitizeUrl } from "./url.js";
import type { KVStore } from "./storage.js";

/**
 * Internal type for storing OAuth state during the OAuth flow.
 * @internal
 */
export interface StoredState {
  expiry: number;
  serverUrlHash: string;
  providerOptions: {
    serverUrl: string;
    storageKeyPrefix: string;
    clientName: string;
    clientUri: string;
    callbackUrl: string;
    oauthProxyUrl?: string;
    clientMetadataUrl?: string;
    staticClientInfo?: OAuthClientInformation;
    scope?: string;
  };
  /** Complete the code exchange in the opener so confidential credentials stay in memory. */
  completeAuthorizationInOpener?: boolean;
  flowType?: "popup" | "redirect";
  returnUrl?: string;
}

/**
 * Common options for OAuthSessionStore.
 *
 * @internal
 */
export interface OAuthSessionStoreOptions {
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
  /** OAuth Client ID Metadata Document URL. */
  clientMetadataUrl?: string;
  /** Whether this platform may persist confidential-client credentials. */
  allowClientSecret?: boolean;
  /** OAuth scope string forwarded to the SDK via clientMetadata.scope. */
  scope?: string;
}

/**
 * Options passed by the platform provider when persisting an authorization
 * request prior to redirecting the user agent.
 *
 * @internal
 */
interface StoreAuthorizationStateOptions {
  /**
   * Platform-specific provider options that should round-trip through the
   * stored state so the callback handler can rebuild the provider.
   */
  extraProviderOptions?: Record<string, unknown>;
  completeAuthorizationInOpener?: boolean;
  flowType?: "popup" | "redirect";
  returnUrl?: string;
}

/**
 * Platform-neutral helper that owns OAuth session persistence and refresh
 * logic. Used by `BrowserOAuthClientProvider` and `NodeOAuthClientProvider`
 * — each platform provider implements `OAuthClientProvider` directly and
 * delegates the generic methods here.
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
  readonly clientMetadataUrl?: string;
  readonly scope?: string;

  private store: KVStore;
  private allowClientSecret: boolean;

  constructor(
    serverUrl: string,
    options: OAuthSessionStoreOptions,
    store: KVStore
  ) {
    validateClientMetadataUrl(options.clientMetadataUrl);
    this.serverUrl = serverUrl;
    this.storageKeyPrefix = options.storageKeyPrefix || "mcp:auth";
    this.serverUrlHash = OAuthSessionStore.hashString(serverUrl);
    this.clientName = options.clientName || "mcp-use";
    this.clientUri =
      options.clientUri ||
      (typeof window !== "undefined"
        ? window.location.origin
        : "https://mcp-use.com");
    this.logoUri = options.logoUri || "https://mcp-use.com/logo.png";
    this.callbackUrl = sanitizeUrl(
      options.callbackUrl ||
        (typeof window !== "undefined"
          ? new URL("/oauth/callback", window.location.origin).toString()
          : "/oauth/callback")
    );
    this.clientMetadataUrl = options.clientMetadataUrl;
    this.scope = options.scope;
    this.store = store;
    this.allowClientSecret = options.allowClientSecret ?? true;
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

  private credentialKey(
    kind: "client_info" | "tokens",
    ctx?: OAuthClientInformationContext
  ): string {
    return ctx
      ? this.getKey(`${kind}_${encodeURIComponent(ctx.issuer)}`)
      : this.getKey(kind);
  }

  private async readCredential<T extends { issuer?: string }>(
    kind: "client_info" | "tokens",
    ctx?: OAuthClientInformationContext
  ): Promise<{ key: string; value: T } | undefined> {
    const key = this.credentialKey(kind, ctx);
    const data = await this.store.get(key);
    if (!data && ctx) {
      const legacyKey = this.credentialKey(kind);
      const legacyData = await this.store.get(legacyKey);
      if (legacyData) {
        try {
          const legacyValue = JSON.parse(legacyData) as T;
          if (!legacyValue.issuer || legacyValue.issuer === ctx.issuer) {
            const migratedValue = {
              ...legacyValue,
              issuer: ctx.issuer,
            };
            const migratedData = JSON.stringify(migratedValue);
            await this.store.set(key, migratedData);
            await this.store.set(legacyKey, migratedData);
            return { key, value: migratedValue };
          }
        } catch {
          await this.store.remove(legacyKey);
        }
      }
      return undefined;
    }
    if (!data) return undefined;
    try {
      return { key, value: JSON.parse(data) as T };
    } catch (e) {
      console.warn(
        `[${this.storageKeyPrefix}] Failed to parse ${kind.replace("_", " ")}:`,
        e
      );
      await this.store.remove(key);
      return undefined;
    }
  }

  async tokens(
    ctx?: OAuthClientInformationContext
  ): Promise<StoredOAuthTokens | undefined> {
    return (await this.readCredential<StoredOAuthTokens>("tokens", ctx))?.value;
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    // Persist tokens BEFORE clearing the verifier / last_auth_url so a failed
    // write can't strand the auth flow with no way to recover.
    const serialized = JSON.stringify(tokens);
    await this.store.set(this.credentialKey("tokens", ctx), serialized);
    // The no-context SDK read is the transport's latest bearer token lookup.
    if (ctx) await this.store.set(this.credentialKey("tokens"), serialized);
    await this.store.remove(this.getKey("code_verifier"));
    await this.store.remove(this.getKey("last_auth_url"));
    await this.store.remove(this.getKey("last_auth_callback_url"));
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext
  ): Promise<OAuthClientInformation | undefined> {
    if (!this.allowClientSecret) {
      const registeredRedirectUri = await this.store.get(
        this.getKey("client_info_redirect_uri")
      );
      if (registeredRedirectUri !== this.redirectUrl) {
        await this.invalidateCredentials("registration");
        console.info(
          `[${this.storageKeyPrefix}] Re-registering browser OAuth client after its Inspector callback changed or could not be verified.`
        );
        return undefined;
      }
    }

    const stored = await this.readCredential<
      OAuthClientInformation & {
        issuer?: string;
        redirect_uris?: string[];
        client_secret?: string;
      }
    >("client_info", ctx);
    if (!stored) return undefined;
    const { key, value: clientInfo } = stored;
    try {
      if (!this.allowClientSecret && clientInfo.client_secret) {
        await this.invalidateCredentials("registration");
        console.warn(
          `[${this.storageKeyPrefix}] Recovered stale browser OAuth credentials containing a client_secret.`
        );
        return undefined;
      }
      const storedRedirectUris = Array.isArray(clientInfo.redirect_uris)
        ? clientInfo.redirect_uris
        : [];
      // Node clients can retain registrations from servers that omit
      // redirect_uris. Browser clients cannot: the same origin may serve both
      // embedded and standalone Inspectors at different callback paths.
      const hasMatchingRedirect =
        (storedRedirectUris.length === 0 && this.allowClientSecret) ||
        storedRedirectUris.includes(this.redirectUrl);

      if (!hasMatchingRedirect) {
        console.info(
          `[${this.storageKeyPrefix}] Recovering cached OAuth credentials after a redirect URI change.`
        );
        await this.invalidateCredentials("registration");
        return undefined;
      }

      return clientInfo;
    } catch {
      await this.store.remove(key);
      return undefined;
    }
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
    ctx?: OAuthClientInformationContext
  ): Promise<void> {
    const info = clientInformation as OAuthClientInformation & {
      client_secret?: string;
    };
    if (!this.allowClientSecret && info.client_secret) {
      await this.store.remove(this.credentialKey("client_info", ctx));
      if (ctx) await this.store.remove(this.credentialKey("client_info"));
      throw new Error(
        "Browser OAuth clients must be public clients; client_secret persistence is not allowed."
      );
    }
    const persistedClientInformation =
      !this.allowClientSecret &&
      (!("redirect_uris" in clientInformation) ||
        !Array.isArray(
          (clientInformation as { redirect_uris?: unknown }).redirect_uris
        ) ||
        (clientInformation as { redirect_uris: unknown[] }).redirect_uris
          .length === 0)
        ? { ...clientInformation, redirect_uris: [this.redirectUrl] }
        : clientInformation;
    const serialized = JSON.stringify(persistedClientInformation);
    await this.store.set(this.credentialKey("client_info", ctx), serialized);
    if (ctx) {
      await this.store.set(this.credentialKey("client_info"), serialized);
    }
    if (!this.allowClientSecret) {
      await this.store.set(
        this.getKey("client_info_redirect_uri"),
        this.redirectUrl
      );
    }
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
    scope:
      | "all"
      | "registration"
      | "client"
      | "tokens"
      | "verifier"
      | "discovery"
  ): Promise<void> {
    const removeCredentialKeys = async (
      kind: "client_info" | "tokens"
    ): Promise<void> => {
      const prefix = `${this.getKey(kind)}_`;
      for (const key of await this.store.keys()) {
        if (key === this.getKey(kind) || key.startsWith(prefix)) {
          await this.store.remove(key);
        }
      }
    };

    switch (scope) {
      case "registration":
        // The SDK saves freshly discovered issuer metadata before it asks for
        // client information. Preserve that callback-leg binding while
        // replacing stale browser registration and authorization artifacts.
        await removeCredentialKeys("tokens");
        await removeCredentialKeys("client_info");
        await this.store.remove(this.getKey("code_verifier"));
        await this.store.remove(this.getKey("last_auth_url"));
        await this.store.remove(this.getKey("last_auth_callback_url"));
        await this.store.remove(this.getKey("client_info_redirect_uri"));
        await this.store.remove(this.getKey("token_endpoint"));
        break;
      case "all":
        await removeCredentialKeys("tokens");
        await removeCredentialKeys("client_info");
        await this.store.remove(this.getKey("code_verifier"));
        await this.store.remove(this.getKey("last_auth_url"));
        await this.store.remove(this.getKey("last_auth_callback_url"));
        await this.store.remove(this.getKey("client_info_redirect_uri"));
        await this.store.remove(this.getKey("discovery_state"));
        await this.store.remove(this.getKey("token_endpoint"));
        break;
      case "client":
        await removeCredentialKeys("client_info");
        break;
      case "tokens":
        await removeCredentialKeys("tokens");
        break;
      case "verifier":
        await this.store.remove(this.getKey("code_verifier"));
        break;
      case "discovery":
        await this.store.remove(this.getKey("discovery_state"));
        break;
      default:
        break;
    }
  }

  /**
   * Persist the OAuth discovery state (authorization-server metadata resolved
   * during the auth flow). Stored with the same durability as the code
   * verifier so the callback leg can verify it is exchanging the code at the
   * same authorization server the redirect targeted (SEP-2352 mix-up defense).
   */
  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.set(this.getKey("discovery_state"), JSON.stringify(state));
  }

  /** Return the previously saved discovery state, or `undefined`. */
  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const data = await this.store.get(this.getKey("discovery_state"));
    if (!data) return undefined;
    try {
      return JSON.parse(data) as OAuthDiscoveryState;
    } catch {
      await this.store.remove(this.getKey("discovery_state"));
      return undefined;
    }
  }

  // --- Helper / non-SDK methods ---

  /**
   * Generates and persists `StoredState` for an authorization request,
   * appends the `state` query param to the URL, and persists the sanitized
   * URL to `last_auth_url` so it can be replayed on popup-blocker fallback.
   *
   * @returns The sanitized authorization URL string with the `state` param appended.
   */
  async storeAuthorizationState(
    authorizationUrl: URL,
    opts: StoreAuthorizationStateOptions = {}
  ): Promise<string> {
    const state = globalThis.crypto.randomUUID();
    const stateKey = `${this.storageKeyPrefix}_${this.serverUrlHash}_state_${state}`;

    const stateData: StoredState = {
      serverUrlHash: this.serverUrlHash,
      expiry: Date.now() + 1000 * 60 * 10, // State expires in 10 minutes
      providerOptions: {
        serverUrl: this.serverUrl,
        storageKeyPrefix: this.storageKeyPrefix,
        clientName: this.clientName,
        clientUri: this.clientUri,
        callbackUrl: this.callbackUrl,
        ...(this.clientMetadataUrl
          ? { clientMetadataUrl: this.clientMetadataUrl }
          : {}),
        ...(opts.extraProviderOptions ?? {}),
      },
      ...(opts.completeAuthorizationInOpener
        ? { completeAuthorizationInOpener: true }
        : {}),
      flowType: opts.flowType,
      returnUrl: opts.returnUrl,
    };

    authorizationUrl.searchParams.set("state", state);
    const sanitizedAuthUrl = sanitizeUrl(authorizationUrl.toString());

    // Persist the state record BEFORE the last_auth_url so a partial failure
    // can't leave behind an auth URL whose state has no backing record.
    await this.store.set(stateKey, JSON.stringify(stateData));
    await this.store.set(
      this.getKey("last_auth_callback_url"),
      this.redirectUrl
    );
    await this.store.set(this.getKey("last_auth_url"), sanitizedAuthUrl);

    return sanitizedAuthUrl;
  }

  /**
   * Return the token endpoint from SDK-managed discovery state. The SDK
   * persists this state during `auth()`, avoiding a second discovery flow.
   */
  async getTokenEndpoint(): Promise<string | null> {
    return (
      (await this.discoveryState())?.authorizationServerMetadata
        ?.token_endpoint ?? null
    );
  }

  /**
   * Return the protected-resource URL selected during OAuth discovery.
   * Consumers can persist it and reuse it for server-side refresh exchanges.
   */
  async getResource(): Promise<string | null> {
    const resource = (await this.discoveryState())?.resourceMetadata?.resource;
    return typeof resource === "string" ? resource : null;
  }
}
