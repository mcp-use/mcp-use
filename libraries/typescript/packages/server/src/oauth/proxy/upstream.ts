import { isLocalhost, isRecord } from "../guards.js";

/** Tokens that an upstream identity provider issued for one user. */
export interface UpstreamTokenSet {
  /** Bearer token for the upstream API. */
  accessToken: string;
  /** Refresh token, when the provider issued one. */
  refreshToken?: string;
  /** Access-token expiry as Unix time in seconds, when the provider gave one. */
  expiresAt?: number;
  /** Scopes that the provider granted. */
  scopes: string[];
  /** OpenID Connect ID token, when the provider issued one. */
  idToken?: string;
}

/** The signed-in user, as the upstream identity provider describes them. */
export interface UpstreamUser {
  /**
   * Stable user identifier at the provider, for example the numeric GitHub
   * user id or the OpenID Connect `sub`. Never an email address or a login
   * name, which can change.
   */
  subject: string;
  /** Profile fields from the provider, for example `login` or `email`. */
  profile: Record<string, unknown>;
}

/**
 * An upstream identity provider with OAuth 2.0 authorization and token
 * endpoints, such as GitHub or Google. The proxy sends the browser to its
 * authorization endpoint as one confidential OAuth app, and exchanges and
 * refreshes codes on the server, so `clientSecret` never leaves the server.
 *
 * Use {@link github}, {@link google}, or {@link upstream} to create one.
 */
export interface RedirectUpstream {
  /** Discriminator for a redirect upstream. */
  kind: "redirect";
  /** Short identifier for the provider, used in storage keys, for example `github`. */
  id: string;
  /** Provider name shown on the consent page, for example `GitHub`. */
  name: string;
  /**
   * Issuer identifier. Required when the token endpoint returns OpenID
   * Connect ID tokens, whose `iss` claim must match it. Defaults to the
   * origin of the authorization endpoint.
   */
  issuer?: string;
  /** Authorization endpoint URL. */
  authorizationEndpoint: string;
  /** Token endpoint URL. */
  tokenEndpoint: string;
  /** Client identifier of the OAuth app registered at the provider. */
  clientId: string;
  /** Client secret of the OAuth app. The proxy sends it only to the token endpoint. */
  clientSecret: string;
  /** Scopes that every sign-in requests from the provider. */
  scopes: readonly string[];
  /**
   * Whether to send an RFC 7636 S256 code challenge upstream.
   *
   * @defaultValue `true`
   */
  pkce?: boolean;
  /** Extra query parameters for the authorization request, for example `access_type`. */
  authorizeParams?: Readonly<Record<string, string>>;
  /**
   * Extra authorization parameters for one more round when a sign-in
   * returns no refresh token and none is stored for the user, for example
   * Google's `prompt=consent`. Leave it unset for providers whose tokens do
   * not expire.
   */
  retryWithoutRefreshToken?: Readonly<Record<string, string>>;
  /**
   * Reads the signed-in user from the provider.
   *
   * @param tokens - Tokens from the code exchange.
   * @param fetch - Fetch implementation to use for the request.
   * @returns The user's stable subject and profile.
   */
  fetchUser(
    tokens: UpstreamTokenSet,
    fetch: typeof globalThis.fetch
  ): Promise<UpstreamUser>;
}

/** Values handed to the page of an {@link InPageUpstream}. */
export interface InPageProps {
  /** The client that asks for access. */
  client: { id: string; name?: string; host?: string };
  /**
   * Form to post the sign-in proof to. Post the proof as the `proof` field,
   * and the `csrf` value as the `csrf` field.
   */
  form: { action: string; csrf: string };
}

/**
 * An identity provider without OAuth endpoints, such as Firebase Auth. The
 * proxy serves a page that signs the user in with the provider's browser SDK
 * and posts a proof (for example an ID token) back for `verify`.
 *
 * The type is public so that presets can target it. `oauthProxy` does not
 * accept in-page upstreams yet.
 */
export interface InPageUpstream {
  /** Discriminator for an in-page upstream. */
  kind: "in-page";
  /** Short identifier for the provider, used in storage keys. */
  id: string;
  /** Provider name shown to the user. */
  name: string;
  /**
   * React component for the sign-in page. It signs in with the provider and
   * posts the proof to `props.form.action`.
   */
  page: (props: InPageProps) => unknown;
  /**
   * Verifies the posted proof.
   *
   * @param proof - The proof the page posted.
   * @returns The signed-in user, and tokens when the provider issues them.
   */
  verify(
    proof: unknown
  ): Promise<{ user: UpstreamUser; tokens?: UpstreamTokenSet }>;
  /**
   * Refreshes upstream tokens.
   *
   * @param tokens - Current tokens.
   * @returns New tokens.
   */
  refresh?(tokens: UpstreamTokenSet): Promise<UpstreamTokenSet>;
}

/** Identity provider behind an OAuth proxy. */
export type Upstream = RedirectUpstream | InPageUpstream;

/** Options for {@link upstream}. */
export type UpstreamOptions = Omit<RedirectUpstream, "kind">;

/**
 * Creates a redirect upstream for any OAuth 2.0 provider with authorization
 * and token endpoints.
 *
 * @param options - Endpoints, OAuth app credentials, scopes, and user lookup.
 * @returns An upstream for `oauthProxy`.
 * @throws A `TypeError` if a field is missing or an endpoint is not HTTPS
 * (HTTP is accepted on localhost).
 *
 * @example
 * ```ts
 * import { oauthProxy, upstream } from "mcp-use/oauth";
 *
 * const oauth = oauthProxy({
 *   upstream: upstream({
 *     id: "acme",
 *     name: "Acme",
 *     authorizationEndpoint: "https://id.acme.dev/oauth/authorize",
 *     tokenEndpoint: "https://id.acme.dev/oauth/token",
 *     clientId: process.env.ACME_CLIENT_ID!,
 *     clientSecret: process.env.ACME_CLIENT_SECRET!,
 *     scopes: ["profile"],
 *     fetchUser: async (tokens, fetch) => {
 *       const response = await fetch("https://api.acme.dev/me", {
 *         headers: { authorization: `Bearer ${tokens.accessToken}` },
 *       });
 *       const me = await response.json();
 *       return { subject: String(me.id), profile: me };
 *     },
 *   }),
 * });
 * ```
 */
export function upstream(options: UpstreamOptions): RedirectUpstream {
  const result: RedirectUpstream = { ...options, kind: "redirect" };
  assertRedirectUpstream(result);
  return result;
}

/** @internal Validates a redirect upstream. */
export function assertRedirectUpstream(value: RedirectUpstream): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError("oauthProxy upstream must be an object");
  }
  for (const field of ["id", "name", "clientId", "clientSecret"] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new TypeError(
        `oauthProxy upstream.${field} must be a non-empty string`
      );
    }
  }
  if (!/^[a-z0-9-]+$/.test(value.id)) {
    throw new TypeError(
      "oauthProxy upstream.id must contain only lowercase letters, digits, and hyphens"
    );
  }
  for (const field of ["authorizationEndpoint", "tokenEndpoint"] as const) {
    assertEndpoint(value[field], `upstream.${field}`);
  }
  if (value.issuer !== undefined)
    assertEndpoint(value.issuer, "upstream.issuer");
  if (
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string" && scope !== "")
  ) {
    throw new TypeError(
      "oauthProxy upstream.scopes must be an array of strings"
    );
  }
  if (typeof value.fetchUser !== "function") {
    throw new TypeError("oauthProxy upstream.fetchUser must be a function");
  }
}

function assertEndpoint(value: unknown, name: string): void {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError(`oauthProxy ${name} must be an absolute URL`);
  }
  if (
    typeof value !== "string" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLocalhost(url))
    )
  ) {
    throw new TypeError(
      `oauthProxy ${name} must be an HTTPS URL (HTTP only on localhost)`
    );
  }
}

/** @internal Failure of an upstream token request. */
export class UpstreamError extends Error {
  /** OAuth error code, for example `invalid_grant`. */
  readonly code: string;
  /** Whether a retry can succeed (network errors, 5xx responses). */
  readonly transient: boolean;

  /**
   * @param code - OAuth error code.
   * @param message - Human-readable message.
   * @param transient - Whether a retry can succeed.
   * @param cause - Underlying error.
   */
  constructor(
    code: string,
    message: string,
    transient: boolean,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "UpstreamError";
    this.code = code;
    this.transient = transient;
  }
}

/** GitHub token errors and their RFC 6749 equivalents. */
const PROVIDER_ERROR_CODES: Record<string, string> = {
  bad_verification_code: "invalid_grant",
  bad_refresh_token: "invalid_grant",
  incorrect_client_credentials: "invalid_client",
  redirect_uri_mismatch: "invalid_grant",
  unverified_user_email: "access_denied",
};

/**
 * Some providers (GitHub) answer token errors with HTTP 200. Rewrite those
 * to the RFC 6749 shape (HTTP 400, standard code) before oauth4webapi reads
 * them.
 */
function normalizingFetch(
  base: typeof globalThis.fetch
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await base(input, init);
    const type = response.headers.get("content-type") ?? "";
    if (
      !type.includes("json") ||
      (response.status !== 200 && response.status !== 400)
    ) {
      return response;
    }
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    if (
      !isRecord(body) ||
      typeof body["error"] !== "string" ||
      body["access_token"] !== undefined
    ) {
      return response;
    }
    const code = PROVIDER_ERROR_CODES[body["error"]] ?? body["error"];
    return new Response(JSON.stringify({ ...body, error: code }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  };
}

interface UpstreamClient {
  oauth: typeof import("oauth4webapi");
  as: import("oauth4webapi").AuthorizationServer;
  client: import("oauth4webapi").Client;
  auth: import("oauth4webapi").ClientAuth;
  options: import("oauth4webapi").TokenEndpointRequestOptions;
}

async function upstreamClient(
  provider: RedirectUpstream,
  fetchImpl: typeof globalThis.fetch
): Promise<UpstreamClient> {
  const oauth = await import("oauth4webapi");
  const issuer =
    provider.issuer ?? new URL(provider.authorizationEndpoint).origin;
  const insecure = [provider.tokenEndpoint, issuer].some(
    (url) => new URL(url).protocol === "http:"
  );
  return {
    oauth,
    as: {
      issuer,
      authorization_endpoint: provider.authorizationEndpoint,
      token_endpoint: provider.tokenEndpoint,
    },
    client: { client_id: provider.clientId },
    auth: oauth.ClientSecretPost(provider.clientSecret),
    options: {
      [oauth.customFetch]: normalizingFetch(fetchImpl),
      // Endpoints were validated: plain HTTP is accepted only on localhost.
      ...(insecure && { [oauth.allowInsecureRequests]: true }),
      signal: AbortSignal.timeout(15_000),
    },
  };
}

/** @internal Exchanges an upstream authorization code on the server. */
export async function exchangeUpstreamCode(
  provider: RedirectUpstream,
  fetchImpl: typeof globalThis.fetch,
  input: {
    callbackParams: URLSearchParams;
    redirectUri: string;
    codeVerifier: string | undefined;
  }
): Promise<UpstreamTokenSet> {
  const { oauth, as, client, auth, options } = await upstreamClient(
    provider,
    fetchImpl
  );
  return runTokenRequest(oauth, provider, async () => {
    const params = oauth.validateAuthResponse(
      as,
      client,
      input.callbackParams,
      oauth.skipStateCheck
    );
    const response = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      auth,
      params,
      input.redirectUri,
      input.codeVerifier ?? oauth.nopkce,
      options
    );
    return oauth.processAuthorizationCodeResponse(as, client, response);
  });
}

/** @internal Refreshes upstream tokens on the server. */
export async function refreshUpstreamTokens(
  provider: RedirectUpstream,
  fetchImpl: typeof globalThis.fetch,
  refreshToken: string
): Promise<UpstreamTokenSet> {
  const { oauth, as, client, auth, options } = await upstreamClient(
    provider,
    fetchImpl
  );
  return runTokenRequest(oauth, provider, async () => {
    const response = await oauth.refreshTokenGrantRequest(
      as,
      client,
      auth,
      refreshToken,
      options
    );
    return oauth.processRefreshTokenResponse(as, client, response);
  });
}

async function runTokenRequest(
  oauth: typeof import("oauth4webapi"),
  provider: RedirectUpstream,
  request: () => Promise<import("oauth4webapi").TokenEndpointResponse>
): Promise<UpstreamTokenSet> {
  let response: import("oauth4webapi").TokenEndpointResponse;
  try {
    response = await request();
  } catch (error) {
    if (error instanceof oauth.ResponseBodyError) {
      return Promise.reject(
        new UpstreamError(
          error.error,
          `${provider.name} token endpoint returned ${error.error}`,
          error.status >= 500,
          error
        )
      );
    }
    if (error instanceof oauth.OperationProcessingError) {
      const status =
        error.cause instanceof Response ? error.cause.status : undefined;
      return Promise.reject(
        new UpstreamError(
          "server_error",
          `${provider.name} token endpoint returned an invalid response`,
          status === undefined || status >= 500,
          error
        )
      );
    }
    return Promise.reject(
      new UpstreamError(
        "temporarily_unavailable",
        `${provider.name} token endpoint is unreachable`,
        true,
        error
      )
    );
  }
  return {
    accessToken: response.access_token,
    ...(response.refresh_token !== undefined && {
      refreshToken: response.refresh_token,
    }),
    ...(typeof response.expires_in === "number" && {
      expiresAt: Math.floor(Date.now() / 1000) + response.expires_in,
    }),
    scopes:
      typeof response.scope === "string"
        ? response.scope.split(/[\s,]+/).filter(Boolean)
        : [...provider.scopes],
    ...(response.id_token !== undefined && { idToken: response.id_token }),
  };
}
