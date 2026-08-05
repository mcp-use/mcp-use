import type {
  OAuthClientProvider,
  OAuthClientInformation,
  OAuthClientInformationContext,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type { PreRegistrationContext } from "./conformance-shared.js";

/** Authorization response captured from the headless redirect. */
export type HeadlessOAuthAuthorizationResponse = {
  code: string;
  /** RFC 9207 authorization-server issuer, when returned by the callback. */
  iss?: string;
};

export class HeadlessConformanceOAuthProvider implements OAuthClientProvider {
  /**
   * Pre-v2 credential storage did not have an issuer key. Keep one unbound
   * entry only long enough for the SDK to stamp it on the first v2 read.
   */
  private legacyClientInfo?: OAuthClientInformationFull;
  private legacyTokenData?: OAuthTokens;
  private readonly clientInfoByIssuer = new Map<
    string,
    OAuthClientInformationFull
  >();
  private readonly tokensByIssuer = new Map<string, OAuthTokens>();
  private latestTokenData?: OAuthTokens;
  private savedDiscoveryState?: OAuthDiscoveryState;
  private storedCodeVerifier?: string;
  private authorizationResponse?: HeadlessOAuthAuthorizationResponse;
  private authorizationState?: string;

  constructor(
    private readonly redirectUri: string,
    private readonly metadata: OAuthClientMetadata,
    private readonly metadataUrl?: string
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  get clientMetadataUrl(): string | undefined {
    return this.metadataUrl;
  }

  async clientInformation(
    context?: OAuthClientInformationContext
  ): Promise<OAuthClientInformation | undefined> {
    if (!context) {
      return (
        this.legacyClientInfo ?? this.clientInfoByIssuer.values().next().value
      );
    }

    // Returning the legacy entry here lets the v2 SDK stamp it with the
    // issuer and re-save it. Once saved with an issuer it is never reused for
    // a different AS, so a migration triggers fresh registration as required.
    return this.clientInfoByIssuer.get(context.issuer) ?? this.legacyClientInfo;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationFull,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    if (context) {
      this.clientInfoByIssuer.set(context.issuer, clientInformation);
      this.legacyClientInfo = undefined;
      return;
    }

    this.legacyClientInfo = clientInformation;
  }

  async tokens(
    context?: OAuthClientInformationContext
  ): Promise<OAuthTokens | undefined> {
    if (!context) {
      // Transport bearer-token reads are issuer-less. The SDK requires the
      // most recently issued token in that case.
      return this.latestTokenData ?? this.legacyTokenData;
    }

    return this.tokensByIssuer.get(context.issuer) ?? this.legacyTokenData;
  }

  async saveTokens(
    tokens: OAuthTokens,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    this.latestTokenData = tokens;
    if (context) {
      this.tokensByIssuer.set(context.issuer, tokens);
      this.legacyTokenData = undefined;
      return;
    }

    this.legacyTokenData = tokens;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    // The headless callback happens in-process, but this must be retained
    // alongside the verifier so the SDK can bind the callback to its issuer.
    this.savedDiscoveryState = state;
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.savedDiscoveryState;
  }

  async state(): Promise<string> {
    // A distinct value is generated for each authorization attempt. The
    // redirect handler verifies the returned value before exposing its code.
    this.authorizationState = crypto.randomUUID();
    return this.authorizationState;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const response = await fetch(authorizationUrl.toString(), {
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (location) {
      const redirected = new URL(location, authorizationUrl);
      if (this.captureAuthorizationResponse(redirected)) return;
    }

    if (this.captureAuthorizationResponse(new URL(response.url))) return;

    throw new Error("Headless OAuth flow did not return an authorization code");
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.storedCodeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this.storedCodeVerifier) {
      throw new Error("No OAuth code verifier available");
    }
    return this.storedCodeVerifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    if (scope === "all" || scope === "client") {
      this.legacyClientInfo = undefined;
      this.clientInfoByIssuer.clear();
    }
    if (scope === "all" || scope === "tokens") {
      this.legacyTokenData = undefined;
      this.latestTokenData = undefined;
      this.tokensByIssuer.clear();
    }
    if (scope === "all" || scope === "verifier") {
      this.storedCodeVerifier = undefined;
      this.authorizationResponse = undefined;
      this.authorizationState = undefined;
    }
    if (scope === "all" || scope === "discovery") {
      this.savedDiscoveryState = undefined;
    }
  }

  async getAuthorizationCode(): Promise<string> {
    return (await this.getAuthorizationResponse()).code;
  }

  /**
   * Returns the complete callback response so callers can pass the RFC 9207
   * `iss` value to the SDK for authorization-server validation.
   */
  async getAuthorizationResponse(): Promise<HeadlessOAuthAuthorizationResponse> {
    if (!this.authorizationResponse) {
      throw new Error("No OAuth authorization code captured");
    }
    return this.authorizationResponse;
  }

  /**
   * Prepare token request parameters for authorization code exchange.
   * This is called by the SDK's auth() function to get the authorization code.
   */
  async prepareTokenRequest(): Promise<URLSearchParams | undefined> {
    const authorizationCode = this.authorizationResponse?.code;
    if (!authorizationCode) {
      return undefined;
    }
    if (!this.storedCodeVerifier) {
      throw new Error("No code verifier available");
    }

    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", authorizationCode);
    params.set("code_verifier", this.storedCodeVerifier);
    params.set("redirect_uri", this.redirectUri);
    return params;
  }

  private captureAuthorizationResponse(callbackUrl: URL): boolean {
    const code = callbackUrl.searchParams.get("code");
    if (!code) return false;

    const returnedState = callbackUrl.searchParams.get("state");
    if (
      this.authorizationState !== undefined &&
      returnedState !== this.authorizationState
    ) {
      throw new Error(
        "OAuth callback state did not match the authorization request"
      );
    }

    const iss = callbackUrl.searchParams.get("iss") ?? undefined;
    this.authorizationResponse = {
      code,
      ...(iss !== undefined ? { iss } : {}),
    };
    return true;
  }
}

const REDIRECT_URI = "http://127.0.0.1:19823/callback";

const DEFAULT_CLIENT_METADATA: OAuthClientMetadata = {
  client_name: "mcp-use-conformance-client",
  redirect_uris: [REDIRECT_URI],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};

export async function createHeadlessConformanceOAuthProvider(options?: {
  preRegistrationContext?: PreRegistrationContext;
}): Promise<HeadlessConformanceOAuthProvider> {
  const usePreRegistration = options?.preRegistrationContext != null;
  const provider = new HeadlessConformanceOAuthProvider(
    REDIRECT_URI,
    DEFAULT_CLIENT_METADATA,
    usePreRegistration
      ? undefined
      : "https://conformance-test.local/client-metadata.json"
  );
  if (options?.preRegistrationContext) {
    const { client_id, client_secret } = options.preRegistrationContext;
    await provider.saveClientInformation({
      client_id,
      client_secret,
      redirect_uris: [REDIRECT_URI],
    });
  }
  return provider;
}
