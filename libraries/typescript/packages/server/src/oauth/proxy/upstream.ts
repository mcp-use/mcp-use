import { isLocalhost, isRecord } from "../guards.js";
import { isBuilding } from "../../build-phase.js";
import type { ConsentPageProps } from "./consent.js";

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

/**
 * Values handed to the consent page when the upstream is an
 * {@link InPageUpstream} such as `firebase()`: the {@link ConsentPageProps}
 * plus a script nonce and whether the user is asked to consent.
 *
 * The proxy adds the upstream's script to the page, so the page needs no
 * script of its own. The script signs the user in when they click a submit
 * button named `decision` with the value `allow`, and then submits the form
 * with the proof. A custom `consent.page` is typed with
 * {@link ConsentPageProps}; read these extra fields with
 * `"consent" in props`.
 */
export interface InPageProps extends ConsentPageProps {
  /**
   * Nonce that the page's Content Security Policy allows. Put it on any
   * inline `<script>` of a custom page; scripts without it do not run.
   */
  nonce: string;
  /**
   * Whether the page asks the user to approve the client. `false` when the
   * consent step was skipped (`consent: false`, or a remembered approval):
   * the page shows only the sign-in button, because the provider's sign-in
   * window opens only on a click.
   */
  consent: boolean;
}

/**
 * An identity provider without OAuth endpoints, such as Firebase Auth. The
 * proxy shows its consent page with the upstream's script added. When the
 * user clicks Allow, the script signs them in with the provider's browser
 * SDK and posts a proof (for example an ID token) with the decision, and the
 * proxy checks it with `verify` on the server.
 *
 * Use {@link firebase} to create one.
 */
export interface InPageUpstream {
  /** Discriminator for an in-page upstream. */
  kind: "in-page";
  /** Short identifier for the provider, used in storage keys, for example `firebase`. */
  id: string;
  /** Provider name shown on the consent page, for example `Firebase`. */
  name: string;
  /**
   * Returns the HTML that the proxy adds at the end of the consent page's
   * body: `<script>` elements that carry `nonce`. The script posts the proof
   * as the `proof` form field.
   *
   * @param nonce - Nonce that the page's Content Security Policy allows.
   * @returns One or more `<script>` elements.
   */
  script(nonce: string): string;
  /**
   * Origins the script needs, added to the consent page's Content Security
   * Policy. Each entry is one CSP source, for example
   * `https://www.gstatic.com`.
   */
  csp?: {
    /** Origins the page loads scripts from (`script-src`). */
    script?: readonly string[];
    /** Origins the page sends requests to (`connect-src`). */
    connect?: readonly string[];
    /** Origins the page embeds in frames (`frame-src`). */
    frame?: readonly string[];
  };
  /**
   * Checks the proof that the page posted.
   *
   * Throw to refuse the sign-in. The error message goes to the server log,
   * so it must not contain the proof.
   *
   * @param proof - The `proof` form field, as the page posted it. It comes
   * from the browser, so treat it as untrusted input.
   * @param context - Request settings of the proxy.
   * @returns The signed-in user, and tokens when the provider issues them.
   * Without tokens, tools get no upstream token.
   */
  verify(
    proof: string,
    context: {
      /** Fetch implementation to use for requests, from the `fetch` option of `oauthProxy`. */
      fetch: typeof globalThis.fetch;
    }
  ): Promise<{
    /** The signed-in user. */
    user: UpstreamUser;
    /** The user's tokens at the provider, when it issues them. */
    tokens?: UpstreamTokenSet;
  }>;
  /**
   * Refreshes upstream tokens on the server before they expire. Without it,
   * the user's sign-ins end when the tokens from `verify` expire.
   *
   * Throw an {@link UpstreamRefreshError} with `revoked: true` when the
   * provider refuses the refresh token for good: the proxy then ends every
   * grant of the user. Any other error counts as temporary.
   *
   * @param tokens - Current tokens of the user.
   * @param context - Request settings of the proxy.
   * @returns New tokens. A missing `refreshToken` keeps the current one.
   */
  refresh?(
    tokens: UpstreamTokenSet,
    context: {
      /** Fetch implementation to use for requests, from the `fetch` option of `oauthProxy`. */
      fetch: typeof globalThis.fetch;
    }
  ): Promise<UpstreamTokenSet>;
}

/**
 * Error that {@link InPageUpstream.refresh} throws when the provider refuses
 * a refresh. With `revoked: true`, the proxy ends every grant of the user,
 * who must sign in again. Otherwise the proxy treats the failure as
 * temporary and keeps the grants.
 */
export class UpstreamRefreshError extends Error {
  /**
   * The provider's error code, for example Firebase's `TOKEN_EXPIRED`. It
   * goes to the server log.
   */
  readonly code: string;
  /** Whether the provider refused the refresh token for good. */
  readonly revoked: boolean;

  /**
   * @param code - The provider's error code.
   * @param options - Whether the refresh token is revoked, and the
   * underlying error.
   */
  constructor(
    code: string,
    options: {
      /** Whether the provider refused the refresh token for good. */
      revoked: boolean;
      /** The underlying error. */
      cause?: unknown;
    }
  ) {
    super(
      `Upstream refresh failed: ${printable(code, 64)}`,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "UpstreamRefreshError";
    this.code = code;
    this.revoked = options.revoked;
  }
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
  // `mcp-use build` runs the entry without serving requests, so it needs no
  // client credentials.
  const fields = isBuilding()
    ? (["id", "name"] as const)
    : (["id", "name", "clientId", "clientSecret"] as const);
  for (const field of fields) {
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

/** @internal Validates an in-page upstream. */
export function assertInPageUpstream(value: InPageUpstream): void {
  if (value === null || typeof value !== "object") {
    throw new TypeError("oauthProxy upstream must be an object");
  }
  for (const field of ["id", "name"] as const) {
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
  if (typeof value.script !== "function") {
    throw new TypeError("oauthProxy upstream.script must be a function");
  }
  if (typeof value.verify !== "function") {
    throw new TypeError("oauthProxy upstream.verify must be a function");
  }
  if (value.refresh !== undefined && typeof value.refresh !== "function") {
    throw new TypeError("oauthProxy upstream.refresh must be a function");
  }
  if (value.csp !== undefined) {
    if (value.csp === null || typeof value.csp !== "object") {
      throw new TypeError("oauthProxy upstream.csp must be an object");
    }
    for (const field of ["script", "connect", "frame"] as const) {
      const sources = value.csp[field];
      if (sources === undefined) continue;
      // A source with a space, `;`, or `,` would add directives or sources
      // to the page's policy.
      if (
        !Array.isArray(sources) ||
        !sources.every(
          (source) => typeof source === "string" && /^[^\s;,'"]+$/.test(source)
        )
      ) {
        throw new TypeError(
          `oauthProxy upstream.csp.${field} must be an array of CSP host sources`
        );
      }
    }
  }
}

/**
 * @internal Validates an upstream endpoint URL: HTTPS, or HTTP on localhost,
 * without credentials or a fragment.
 */
export function assertEndpoint(value: unknown, name: string): void {
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

/**
 * @internal Failure of an upstream callback or token request. Its message
 * and `detail` are safe to log: they never hold token, code, or body values.
 */
export class UpstreamError extends Error {
  /** RFC 6749 error code, for example `invalid_grant`. */
  readonly code: string;
  /** Whether a retry can succeed (network errors, 5xx responses). */
  readonly transient: boolean;
  /** The provider's own error code, for example GitHub's `bad_verification_code`. */
  readonly upstreamCode: string | undefined;
  /** The provider's `error_description`, cleaned for logs. */
  readonly description: string | undefined;
  /** Diagnostics for logs, such as the HTTP status and content type. */
  readonly detail: string | undefined;

  /**
   * @param code - RFC 6749 error code.
   * @param message - Human-readable message.
   * @param transient - Whether a retry can succeed.
   * @param options - Underlying error and diagnostics.
   */
  constructor(
    code: string,
    message: string,
    transient: boolean,
    options: {
      cause?: unknown;
      upstreamCode?: string;
      description?: string;
      detail?: string;
    } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "UpstreamError";
    this.code = code;
    this.transient = transient;
    this.upstreamCode = options.upstreamCode;
    this.description = options.description;
    this.detail = options.detail;
  }
}

/**
 * @internal Makes a value from a provider or a browser safe to log: no
 * control characters, at most `max` characters.
 */
export function printable(value: string, max = 200): string {
  // eslint-disable-next-line no-control-regex -- control characters are what it removes
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** GitHub token errors and their RFC 6749 equivalents. */
const PROVIDER_ERROR_CODES: Record<string, string> = {
  bad_verification_code: "invalid_grant",
  bad_refresh_token: "invalid_grant",
  incorrect_client_credentials: "invalid_client",
  redirect_uri_mismatch: "invalid_grant",
  unverified_user_email: "access_denied",
};

/** Body field that keeps the provider's own code after a rewrite. */
const UPSTREAM_CODE_FIELD = "mcp_use_upstream_error";
/** Header that keeps the provider's HTTP status after a rewrite. */
const UPSTREAM_STATUS_HEADER = "x-mcp-use-upstream-status";

/**
 * Some providers (GitHub) answer token errors with HTTP 200. Rewrite those
 * to the RFC 6749 shape (HTTP 400, standard code) before oauth4webapi reads
 * them, keeping the original code and status for logs.
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
    return new Response(
      JSON.stringify({
        ...body,
        error: code,
        [UPSTREAM_CODE_FIELD]: body["error"],
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
          [UPSTREAM_STATUS_HEADER]: String(response.status),
        },
      }
    );
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
  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(
      as,
      client,
      input.callbackParams,
      oauth.skipStateCheck
    );
  } catch (error) {
    throw callbackError(oauth, provider, error);
  }
  return runTokenRequest(oauth, provider, async () => {
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

/**
 * Describes a callback that failed validation, such as one whose `iss` names
 * another issuer. The callback parameters hold the authorization code, so
 * only `iss` is read from them.
 */
function callbackError(
  oauth: typeof import("oauth4webapi"),
  provider: RedirectUpstream,
  error: unknown
): UpstreamError {
  if (error instanceof oauth.AuthorizationResponseError) {
    const code = printable(error.error, 64);
    return new UpstreamError(
      "server_error",
      `${provider.name} returned ${code} to the callback`,
      false,
      {
        cause: error,
        upstreamCode: code,
        ...(error.error_description !== undefined && {
          description: printable(error.error_description),
        }),
      }
    );
  }
  const facts: string[] = [];
  if (error instanceof oauth.OperationProcessingError) {
    const cause: unknown = error.cause;
    if (isRecord(cause) && typeof cause["expected"] === "string") {
      facts.push(`expected ${JSON.stringify(cause["expected"])}`);
      const parameters = cause["parameters"];
      if (parameters instanceof URLSearchParams && parameters.has("iss")) {
        facts.push(
          `got ${JSON.stringify(printable(parameters.get("iss") ?? ""))}`
        );
      }
    }
  }
  return new UpstreamError(
    "server_error",
    `${provider.name} callback failed validation: ${errorText(error)}`,
    false,
    { cause: error, ...(facts.length > 0 && { detail: facts.join(", ") }) }
  );
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
    return Promise.reject(tokenRequestError(oauth, provider, error));
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

/**
 * Describes a failed token request for logs. Token responses and their
 * causes can hold tokens, so only status, content type, codes, and field
 * names are read from them.
 */
function tokenRequestError(
  oauth: typeof import("oauth4webapi"),
  provider: RedirectUpstream,
  error: unknown
): UpstreamError {
  const endpoint = `${provider.name} token endpoint`;
  if (error instanceof oauth.ResponseBodyError) {
    const body: unknown = error.cause;
    const original = isRecord(body) ? body[UPSTREAM_CODE_FIELD] : undefined;
    const upstreamCode = printable(
      typeof original === "string" ? original : error.error,
      64
    );
    const status =
      Number(error.response.headers.get(UPSTREAM_STATUS_HEADER)) ||
      error.status;
    const description =
      error.error_description === undefined
        ? undefined
        : printable(error.error_description);
    return new UpstreamError(
      error.error,
      `${endpoint} returned ${upstreamCode}${
        description === undefined ? "" : `: ${description}`
      }`,
      status >= 500,
      {
        cause: error,
        upstreamCode,
        ...(description !== undefined && { description }),
        detail: `HTTP ${status}`,
      }
    );
  }
  if (error instanceof oauth.WWWAuthenticateChallengeError) {
    // A 401 with a challenge: the provider refused the client credentials.
    const schemes = error.cause.map((challenge) => challenge.scheme);
    return new UpstreamError(
      "invalid_client",
      `${endpoint} refused the client credentials`,
      error.status >= 500,
      {
        cause: error,
        detail: `HTTP ${error.status}, WWW-Authenticate ${schemes.join(", ")}`,
      }
    );
  }
  if (error instanceof oauth.OperationProcessingError) {
    const cause: unknown = error.cause;
    const facts: string[] = [];
    let status: number | undefined;
    if (cause instanceof Response) {
      status = cause.status;
      facts.push(
        `HTTP ${status}`,
        `content-type ${cause.headers.get("content-type") ?? "none"}`
      );
    } else if (isRecord(cause) && isRecord(cause["body"])) {
      const fields = Object.keys(cause["body"]);
      facts.push(`fields ${fields.length > 0 ? fields.join(", ") : "none"}`);
    }
    if (error.code !== undefined) facts.push(error.code);
    return new UpstreamError(
      "server_error",
      `${endpoint} returned an unusable response: ${error.message}`,
      status !== undefined && status >= 500,
      { cause: error, detail: facts.join(", ") }
    );
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new UpstreamError(
      "temporarily_unavailable",
      `${endpoint} did not answer in time`,
      true,
      { cause: error }
    );
  }
  // fetch() rejects with a TypeError whose cause names the network failure
  // (ECONNREFUSED, ENOTFOUND, CERT_HAS_EXPIRED…). oauth4webapi's own
  // TypeErrors carry a code of their own.
  if (error instanceof TypeError && !("code" in error)) {
    const cause: unknown = error.cause;
    const reason =
      isRecord(cause) && typeof cause["code"] === "string"
        ? cause["code"]
        : cause instanceof Error
          ? cause.message
          : error.message;
    return new UpstreamError(
      "temporarily_unavailable",
      `${endpoint} is unreachable: ${printable(reason)}`,
      true,
      { cause: error }
    );
  }
  return new UpstreamError(
    "server_error",
    `${endpoint} request failed: ${errorText(error)}`,
    false,
    { cause: error }
  );
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return printable(String(error));
  const code =
    "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
  return printable(`${error.name}: ${error.message}${code}`);
}
