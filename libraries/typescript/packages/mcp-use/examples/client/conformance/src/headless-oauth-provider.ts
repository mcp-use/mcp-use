import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export class HeadlessConformanceOAuthProvider implements OAuthClientProvider {
  private clientInfo?: OAuthClientInformationFull;
  private tokenData?: OAuthTokens;
  private storedCodeVerifier?: string;
  private authorizationCode?: string;

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

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.clientInfo;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationFull
  ): Promise<void> {
    this.clientInfo = clientInformation;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.tokenData;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.tokenData = tokens;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const response = await fetch(authorizationUrl.toString(), {
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (location) {
      const redirected = new URL(location, authorizationUrl);
      const code = redirected.searchParams.get("code");
      if (code) {
        this.authorizationCode = code;
        return;
      }
    }

    const fallbackCode = new URL(response.url).searchParams.get("code");
    if (fallbackCode) {
      this.authorizationCode = fallbackCode;
      return;
    }

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

  async getAuthorizationCode(): Promise<string> {
    if (!this.authorizationCode) {
      throw new Error("No OAuth authorization code captured");
    }
    return this.authorizationCode;
  }

  /**
   * Prepare token request parameters for authorization code exchange.
   * This is called by the SDK's auth() function to get the authorization code.
   */
  async prepareTokenRequest(): Promise<URLSearchParams | undefined> {
    if (!this.authorizationCode) {
      return undefined;
    }
    if (!this.storedCodeVerifier) {
      throw new Error("No code verifier available");
    }

    const params = new URLSearchParams();
    params.set("grant_type", "authorization_code");
    params.set("code", this.authorizationCode);
    params.set("code_verifier", this.storedCodeVerifier);
    params.set("redirect_uri", this.redirectUri);
    return params;
  }
}

export function createHeadlessConformanceOAuthProvider(): HeadlessConformanceOAuthProvider {
  return new HeadlessConformanceOAuthProvider(
    "http://127.0.0.1:19823/callback",
    {
      client_name: "mcp-use-conformance-client",
      redirect_uris: ["http://127.0.0.1:19823/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    "https://conformance-test.local/client-metadata.json"
  );
}
