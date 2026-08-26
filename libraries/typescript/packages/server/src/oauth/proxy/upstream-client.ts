import { assertSecureHttpUrl, isRecord, parseAbsoluteUrl } from "../guards.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

const AUTHORIZATION_RESERVED_PARAMS = new Set([
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "nonce",
  "redirect_uri",
  "resource",
  "response_type",
  "scope",
  "state",
]);

const TOKEN_RESERVED_PARAMS = new Set([
  "client_id",
  "client_secret",
  "code",
  "code_verifier",
  "grant_type",
  "redirect_uri",
  "refresh_token",
  "resource",
  "scope",
]);

const REVOCATION_RESERVED_PARAMS = new Set([
  "client_id",
  "client_secret",
  "token",
  "token_type_hint",
]);

/** @internal Explicit authentication methods supported at upstream token endpoints. */
export type UpstreamTokenEndpointAuthMethod =
  | "client_secret_basic"
  | "client_secret_post"
  | "none";

/** @internal Construction options for the dependency-free upstream OAuth client. */
export interface UpstreamOAuthClientOptions {
  /** Upstream authorization endpoint. */
  authorizationEndpoint: string | URL;
  /** Upstream token endpoint. */
  tokenEndpoint: string | URL;
  /** Optional RFC 7009 token revocation endpoint. */
  revocationEndpoint?: string | URL;
  /** Expected RFC 9207 authorization-response issuer, when issuer validation is enabled. */
  issuer?: string | URL;
  /** Require the upstream callback to include `iss`; returned values are checked whenever present. */
  requireAuthorizationResponseIssuer?: boolean;
  /** Pre-registered upstream client identifier. */
  clientId: string;
  /** Client secret required by secret-based authentication methods. */
  clientSecret?: string;
  /** Explicit token endpoint client authentication method. */
  tokenEndpointAuthMethod: UpstreamTokenEndpointAuthMethod;
  /** Extra, non-reserved parameters included in every authorization request. */
  authorizationParams?: Readonly<Record<string, string>>;
  /** Fetch implementation used for upstream requests. */
  fetch?: typeof fetch;
  /** Total timeout covering response headers and response-body streaming. */
  timeoutMs?: number;
  /** Maximum number of response-body bytes read from an upstream endpoint. */
  maxResponseBytes?: number;
  /** Web Crypto implementation, primarily for isolated runtimes and tests. */
  crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
}

/** @internal Inputs used to construct one upstream authorization request. */
export interface UpstreamAuthorizationRequest {
  /** Redirect URI registered for the upstream client. */
  redirectUri: string | URL;
  /** Requested scopes, either as an OAuth scope string or individual values. */
  scopes?: string | readonly string[];
  /** Whether to generate and bind an OpenID Connect nonce. */
  includeNonce?: boolean;
  /** Explicit upstream RFC 8707 resource indicator for this request only. */
  resource?: string | URL;
  /** Additional non-reserved authorization parameters for this request. */
  extraParams?: Readonly<Record<string, string>>;
}

/** @internal Secrets that bind an authorization response to its original request. */
export interface UpstreamAuthorizationTransaction {
  /** Random OAuth state value. */
  readonly state: string;
  /** PKCE verifier corresponding to the authorization URL's S256 challenge. */
  readonly codeVerifier: string;
  /** Redirect URI bound to the authorization request. */
  readonly redirectUri: string;
  /** Authorization-request resource binding, which is never auto-forwarded. */
  readonly resource?: string;
  /** Optional OpenID Connect nonce. */
  readonly nonce?: string;
}

/** @internal An upstream authorization URL and the transaction that must be stored with it. */
export interface UpstreamAuthorizationResult {
  /** URL to which the user agent should be redirected. */
  readonly url: URL;
  /** Transaction required to validate and exchange the authorization response. */
  readonly transaction: UpstreamAuthorizationTransaction;
}

/** @internal Inputs for validating an authorization response and exchanging its code. */
export interface UpstreamAuthorizationCodeExchange {
  /** Callback URL or its already-parsed query parameters. */
  authorizationResponse: URL | URLSearchParams;
  /** Stored transaction returned by {@link UpstreamOAuthClient.createAuthorizationRequest}. */
  transaction: UpstreamAuthorizationTransaction;
  /** Explicit upstream RFC 8707 resource indicator for this exchange only. */
  resource?: string | URL;
  /** Additional non-reserved token parameters for this request. */
  extraParams?: Readonly<Record<string, string>>;
  /** Optional caller cancellation signal, composed with the configured timeout. */
  signal?: AbortSignal;
}

/** @internal Inputs for an upstream refresh-token grant. */
export interface UpstreamRefreshTokenRequest {
  /** Refresh token from the current token set. */
  refreshToken: string;
  /** Current scope, optionally sent upstream and preserved if the response omits scope. */
  scope?: string;
  /** Explicit upstream RFC 8707 resource indicator for this refresh only. */
  resource?: string | URL;
  /** Additional non-reserved token parameters for this request. */
  extraParams?: Readonly<Record<string, string>>;
  /** Optional caller cancellation signal, composed with the configured timeout. */
  signal?: AbortSignal;
}

/** @internal Inputs for RFC 7009 upstream token revocation. */
export interface UpstreamTokenRevocationRequest {
  /** Token to revoke. */
  token: string;
  /** Optional hint describing the submitted token. */
  tokenTypeHint?: "access_token" | "refresh_token" | string;
  /** Additional non-reserved revocation parameters for this request. */
  extraParams?: Readonly<Record<string, string>>;
  /** Optional caller cancellation signal, composed with the configured timeout. */
  signal?: AbortSignal;
}

/** @internal Normalized successful token response returned by the upstream client. */
export interface UpstreamTokenSet {
  /** Upstream access token. */
  readonly accessToken: string;
  /** Upstream token type. */
  readonly tokenType: string;
  /** Lifetime in seconds, when returned by the upstream. */
  readonly expiresIn?: number;
  /** Refresh token, including the previous token when a refresh response omits rotation. */
  readonly refreshToken?: string;
  /** Granted scope, including the previous scope when a refresh response omits it. */
  readonly scope?: string;
  /** Unverified ID-token string. This client never decodes or trusts its claims. */
  readonly idToken?: string;
}

/** @internal Normalized, secret-safe failure from an upstream OAuth operation. */
export class UpstreamOAuthError extends Error {
  /** Stable OAuth or client-side error code. */
  readonly code: string;
  /** Upstream HTTP status, when a response was received. */
  readonly status?: number;
  /** Sanitized upstream error description, when one was returned. */
  readonly description?: string;

  /** Creates a normalized upstream OAuth failure. */
  constructor(
    code: string,
    message: string,
    options: { status?: number; description?: string } = {}
  ) {
    super(message);
    this.name = "UpstreamOAuthError";
    this.code = code;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.description !== undefined) {
      this.description = options.description;
    }
  }
}

/**
 * @internal Dependency-free OAuth 2.0 client used behind the server's proxy
 * adapter. It intentionally does not discover endpoints or infer client
 * authentication methods.
 */
export class UpstreamOAuthClient {
  readonly #authorizationEndpoint: URL;
  readonly #tokenEndpoint: URL;
  readonly #revocationEndpoint?: URL;
  readonly #issuer?: string;
  readonly #requireAuthorizationResponseIssuer: boolean;
  readonly #clientId: string;
  readonly #clientSecret?: string;
  readonly #authMethod: UpstreamTokenEndpointAuthMethod;
  readonly #authorizationParams: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #crypto: Pick<Crypto, "getRandomValues" | "subtle">;

  /** Validates and stores immutable upstream client configuration. */
  constructor(options: UpstreamOAuthClientOptions) {
    this.#authorizationEndpoint = parseEndpoint(
      options.authorizationEndpoint,
      "authorizationEndpoint",
      AUTHORIZATION_RESERVED_PARAMS
    );
    this.#tokenEndpoint = parseEndpoint(
      options.tokenEndpoint,
      "tokenEndpoint",
      TOKEN_RESERVED_PARAMS
    );
    if (options.revocationEndpoint !== undefined) {
      this.#revocationEndpoint = parseEndpoint(
        options.revocationEndpoint,
        "revocationEndpoint",
        REVOCATION_RESERVED_PARAMS
      );
    }
    if (options.issuer !== undefined) {
      this.#issuer = parseIssuer(options.issuer);
    }
    this.#requireAuthorizationResponseIssuer =
      options.requireAuthorizationResponseIssuer ?? false;
    if (
      this.#requireAuthorizationResponseIssuer &&
      this.#issuer === undefined
    ) {
      throw new TypeError(
        "issuer is required when requireAuthorizationResponseIssuer is true"
      );
    }
    this.#clientId = requireNonEmpty(options.clientId, "clientId");
    this.#authMethod = options.tokenEndpointAuthMethod;
    if (
      this.#authMethod !== "client_secret_basic" &&
      this.#authMethod !== "client_secret_post" &&
      this.#authMethod !== "none"
    ) {
      throw new TypeError("tokenEndpointAuthMethod is not supported");
    }
    if (this.#authMethod === "none") {
      if (options.clientSecret !== undefined) {
        throw new TypeError(
          "clientSecret must be omitted when tokenEndpointAuthMethod is none"
        );
      }
    } else {
      this.#clientSecret = requireNonEmpty(
        options.clientSecret,
        "clientSecret"
      );
    }
    this.#authorizationParams = validateExtraParams(
      options.authorizationParams,
      AUTHORIZATION_RESERVED_PARAMS,
      this.#authorizationEndpoint.searchParams,
      "authorizationParams"
    );
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== "function") {
      throw new TypeError("fetch must be available");
    }
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs"
    );
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes"
    );
    this.#crypto = options.crypto ?? globalThis.crypto;
    if (
      this.#crypto === undefined ||
      typeof this.#crypto.getRandomValues !== "function" ||
      typeof this.#crypto.subtle?.digest !== "function"
    ) {
      throw new TypeError("Web Crypto must be available");
    }
  }

  /** Builds an authorization URL with a fresh state value and S256 PKCE binding. */
  async createAuthorizationRequest(
    request: UpstreamAuthorizationRequest
  ): Promise<UpstreamAuthorizationResult> {
    const redirectUri = secureRedirectUri(request.redirectUri, "redirectUri");
    const state = randomBase64Url(this.#crypto, 32);
    const codeVerifier = randomBase64Url(this.#crypto, 32);
    const codeChallenge = await sha256Base64Url(this.#crypto, codeVerifier);
    const nonce = request.includeNonce
      ? randomBase64Url(this.#crypto, 32)
      : undefined;
    const url = new URL(this.#authorizationEndpoint);
    const extraParams = validateExtraParams(
      request.extraParams,
      AUTHORIZATION_RESERVED_PARAMS,
      url.searchParams,
      "extraParams",
      Object.keys(this.#authorizationParams)
    );

    setParams(url.searchParams, this.#authorizationParams);
    setParams(url.searchParams, extraParams);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    const scope = normalizeScope(request.scopes);
    if (scope !== undefined) {
      url.searchParams.set("scope", scope);
    }
    if (nonce !== undefined) {
      url.searchParams.set("nonce", nonce);
    }
    const resource =
      request.resource === undefined
        ? undefined
        : resourceUri(request.resource);
    if (resource !== undefined) {
      url.searchParams.set("resource", resource);
    }

    return {
      url,
      transaction: {
        state,
        codeVerifier,
        redirectUri,
        ...(resource !== undefined && { resource }),
        ...(nonce !== undefined && { nonce }),
      },
    };
  }

  /**
   * Validates callback state and optional issuer against the stored transaction,
   * then exchanges the returned code with its bound PKCE verifier.
   */
  async exchangeAuthorizationCode(
    request: UpstreamAuthorizationCodeExchange
  ): Promise<UpstreamTokenSet> {
    const responseParams =
      request.authorizationResponse instanceof URL
        ? request.authorizationResponse.searchParams
        : request.authorizationResponse;
    const sensitive = transactionSecrets(
      request.transaction,
      this.#clientSecret
    );
    const state = singleParam(responseParams, "state");
    if (
      state === undefined ||
      !constantTimeStringEqual(state, request.transaction.state)
    ) {
      throw oauthFailure("state_mismatch", "OAuth state validation failed");
    }
    const returnedIssuer = singleParam(responseParams, "iss");
    if (this.#issuer !== undefined) {
      if (
        (returnedIssuer !== undefined && returnedIssuer !== this.#issuer) ||
        (returnedIssuer === undefined &&
          this.#requireAuthorizationResponseIssuer)
      ) {
        throw oauthFailure(
          "issuer_mismatch",
          "OAuth authorization-response issuer validation failed"
        );
      }
    }
    const callbackError = singleParam(responseParams, "error");
    if (callbackError !== undefined) {
      throw providerOAuthError(
        "authorization",
        callbackError,
        singleParam(responseParams, "error_description"),
        undefined,
        sensitive
      );
    }
    const code = singleParam(responseParams, "code");
    if (code === undefined || code.length === 0) {
      throw oauthFailure(
        "invalid_authorization_response",
        "OAuth authorization response did not contain a code"
      );
    }
    const redirectUri = secureRedirectUri(
      request.transaction.redirectUri,
      "transaction.redirectUri"
    );
    const requestedResource =
      request.resource === undefined
        ? undefined
        : resourceUri(request.resource);
    if (requestedResource !== request.transaction.resource) {
      throw oauthFailure(
        "resource_mismatch",
        "OAuth token resource does not match the authorization transaction"
      );
    }
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: requireNonEmpty(
        request.transaction.codeVerifier,
        "transaction.codeVerifier"
      ),
    });
    if (requestedResource !== undefined) {
      params.set("resource", requestedResource);
    }
    this.#appendClientAuthentication(params);
    this.#appendExtraTokenParams(params, request.extraParams);
    const parsed = await this.#postForm(
      this.#tokenEndpoint,
      params,
      "token exchange",
      [...sensitive, code],
      false,
      request.signal
    );
    return parseTokenSet(parsed, "token exchange");
  }

  /** Performs a refresh-token grant and applies OAuth token rotation semantics. */
  async refreshToken(
    request: UpstreamRefreshTokenRequest
  ): Promise<UpstreamTokenSet> {
    const refreshToken = requireNonEmpty(request.refreshToken, "refreshToken");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (request.scope !== undefined) {
      params.set("scope", normalizeScope(request.scope)!);
    }
    if (request.resource !== undefined) {
      params.set("resource", resourceUri(request.resource));
    }
    this.#appendClientAuthentication(params);
    this.#appendExtraTokenParams(params, request.extraParams);
    const parsed = await this.#postForm(
      this.#tokenEndpoint,
      params,
      "token refresh",
      [this.#clientSecret, refreshToken],
      false,
      request.signal
    );
    const next = parseTokenSet(parsed, "token refresh");
    return {
      ...next,
      refreshToken: next.refreshToken ?? refreshToken,
      ...(next.scope === undefined && request.scope !== undefined
        ? { scope: request.scope }
        : {}),
    };
  }

  /** Revokes a token with RFC 7009 when a revocation endpoint is configured. */
  async revokeToken(request: UpstreamTokenRevocationRequest): Promise<void> {
    if (this.#revocationEndpoint === undefined) {
      throw oauthFailure(
        "revocation_not_configured",
        "OAuth revocation endpoint is not configured"
      );
    }
    const token = requireNonEmpty(request.token, "token");
    const params = new URLSearchParams({ token });
    if (request.tokenTypeHint !== undefined) {
      params.set(
        "token_type_hint",
        requireNonEmpty(request.tokenTypeHint, "tokenTypeHint")
      );
    }
    this.#appendClientAuthentication(params);
    const extraParams = validateExtraParams(
      request.extraParams,
      REVOCATION_RESERVED_PARAMS,
      this.#revocationEndpoint.searchParams,
      "extraParams"
    );
    setParams(params, extraParams);
    await this.#postForm(
      this.#revocationEndpoint,
      params,
      "token revocation",
      [this.#clientSecret, token],
      true,
      request.signal
    );
  }

  /**
   * Validates a transaction nonce only against claims already verified by the
   * caller. This method never accepts or decodes a raw ID token.
   */
  validateVerifiedIdTokenClaims(
    transaction: UpstreamAuthorizationTransaction,
    verifiedClaims: Readonly<Record<string, unknown>>
  ): void {
    if (transaction.nonce === undefined) {
      return;
    }
    if (!isRecord(verifiedClaims)) {
      throw oauthFailure(
        "invalid_verified_claims",
        "Verified ID-token claims must be an object"
      );
    }
    const nonce = verifiedClaims.nonce;
    if (
      typeof nonce !== "string" ||
      !constantTimeStringEqual(nonce, transaction.nonce)
    ) {
      throw oauthFailure(
        "nonce_mismatch",
        "Verified ID-token nonce validation failed"
      );
    }
  }

  #appendClientAuthentication(params: URLSearchParams): void {
    if (this.#authMethod === "client_secret_post") {
      params.set("client_id", this.#clientId);
      params.set("client_secret", this.#clientSecret!);
    } else if (this.#authMethod === "none") {
      params.set("client_id", this.#clientId);
    }
  }

  #appendExtraTokenParams(
    params: URLSearchParams,
    extraParams?: Readonly<Record<string, string>>
  ): void {
    const validated = validateExtraParams(
      extraParams,
      TOKEN_RESERVED_PARAMS,
      this.#tokenEndpoint.searchParams,
      "extraParams"
    );
    setParams(params, validated);
  }

  async #postForm(
    endpoint: URL,
    params: URLSearchParams,
    operation: string,
    sensitiveValues: readonly (string | undefined)[],
    allowEmptySuccess = false,
    callerSignal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const headers = new Headers({
      accept: "application/json, application/x-www-form-urlencoded",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    });
    if (this.#authMethod === "client_secret_basic") {
      headers.set(
        "authorization",
        `Basic ${base64Utf8(`${formEncode(this.#clientId)}:${formEncode(this.#clientSecret!)}`)}`
      );
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(endpoint, {
        method: "POST",
        headers,
        body: params,
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      ) {
        throw oauthFailure(
          "redirect_not_allowed",
          `Upstream OAuth ${operation} returned a redirect`,
          response.status
        );
      }
      text = await readBoundedText(
        response,
        this.#maxResponseBytes,
        controller.signal
      );
    } catch (error) {
      if (error instanceof UpstreamOAuthError) {
        throw error;
      }
      if (timedOut) {
        throw oauthFailure("timeout", `Upstream OAuth ${operation} timed out`);
      }
      if (callerSignal?.aborted) {
        throw oauthFailure(
          "aborted",
          `Upstream OAuth ${operation} was cancelled`
        );
      }
      throw oauthFailure(
        "network_error",
        `Upstream OAuth ${operation} request failed`
      );
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }

    let parsed: Record<string, unknown> | undefined;
    if (text.length > 0) {
      try {
        parsed = parseOAuthBody(text, response.headers.get("content-type"));
      } catch (error) {
        if (
          !response.ok &&
          error instanceof UpstreamOAuthError &&
          error.code === "malformed_response"
        ) {
          throw oauthFailure(
            "upstream_http_error",
            `Upstream OAuth ${operation} failed`,
            response.status
          );
        }
        throw error;
      }
      if (typeof parsed.error === "string") {
        throw providerOAuthError(
          operation,
          parsed.error,
          typeof parsed.error_description === "string"
            ? parsed.error_description
            : undefined,
          response.status,
          sensitiveValues
        );
      }
    }
    if (!response.ok) {
      throw oauthFailure(
        "upstream_http_error",
        `Upstream OAuth ${operation} failed`,
        response.status
      );
    }
    if (parsed === undefined) {
      if (allowEmptySuccess) {
        return {};
      }
      throw oauthFailure(
        "malformed_response",
        `Upstream OAuth ${operation} returned an empty response`,
        response.status
      );
    }
    return parsed;
  }
}

function parseEndpoint(
  value: string | URL,
  name: string,
  reservedParams: ReadonlySet<string>
): URL {
  const url = parseAbsoluteUrl(value, name);
  assertSecureHttpUrl(url, name);
  if (url.hash !== "") {
    throw new TypeError(`${name} must not include a fragment`);
  }
  assertNoDuplicateParams(url.searchParams, `${name} query`);
  for (const key of url.searchParams.keys()) {
    if (reservedParams.has(key)) {
      throw new TypeError(
        `${name} query must not set reserved parameter ${key}`
      );
    }
  }
  return new URL(url);
}

function parseIssuer(value: string | URL): string {
  const original = typeof value === "string" ? value : value.href;
  const url = parseAbsoluteUrl(value, "issuer");
  assertSecureHttpUrl(url, "issuer");
  if (url.search !== "" || url.hash !== "") {
    throw new TypeError("issuer must not include a query string or fragment");
  }
  return original;
}

function secureRedirectUri(value: string | URL, name: string): string {
  const url = parseAbsoluteUrl(value, name);
  assertSecureHttpUrl(url, name);
  if (url.hash !== "") {
    throw new TypeError(`${name} must not include a fragment`);
  }
  return url.href;
}

function resourceUri(value: string | URL): string {
  const url = parseAbsoluteUrl(value, "resource");
  assertSecureHttpUrl(url, "resource");
  if (url.hash !== "") {
    throw new TypeError("resource must not include a fragment");
  }
  return url.href;
}

function validateExtraParams(
  value: Readonly<Record<string, string>> | undefined,
  reserved: ReadonlySet<string>,
  endpointParams: URLSearchParams,
  name: string,
  additionalCollisions: readonly string[] = []
): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new TypeError(`${name} must be an object of string values`);
  }
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  const collisionSet = new Set(additionalCollisions);
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || typeof entry !== "string") {
      throw new TypeError(
        `${name} must contain non-empty keys and string values`
      );
    }
    if (reserved.has(key)) {
      throw new TypeError(`${name} must not set reserved parameter ${key}`);
    }
    if (endpointParams.has(key) || collisionSet.has(key)) {
      throw new TypeError(
        `${name} parameter ${key} collides with configured parameters`
      );
    }
    result[key] = entry;
  }
  return result;
}

function assertNoDuplicateParams(params: URLSearchParams, name: string): void {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw new TypeError(
        `${name} must not contain duplicate parameter ${key}`
      );
    }
    seen.add(key);
  }
}

function setParams(
  params: URLSearchParams,
  values: Readonly<Record<string, string>>
): void {
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
}

function normalizeScope(
  value: string | readonly string[] | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const members =
    typeof value === "string" ? value.split(" ") : Array.from(value);
  if (members.length === 0 || members.some((member) => member.length === 0)) {
    throw new TypeError("scopes must contain at least one non-empty value");
  }
  const seen = new Set<string>();
  for (const member of members) {
    if (!/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(member)) {
      throw new TypeError(
        "scopes contain a value outside the OAuth scope syntax"
      );
    }
    if (seen.has(member)) {
      throw new TypeError("scopes must not contain duplicate values");
    }
    seen.add(member);
  }
  return members.join(" ");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function randomBase64Url(
  cryptoImpl: Pick<Crypto, "getRandomValues">,
  length: number
): string {
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(
  cryptoImpl: Pick<Crypto, "subtle">,
  value: string
): Promise<string> {
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function singleParam(
  params: URLSearchParams,
  name: string
): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw oauthFailure(
      "invalid_authorization_response",
      `OAuth authorization response contains duplicate ${name}`
    );
  }
  return values[0];
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    await response.body?.cancel();
    throw oauthFailure(
      "response_too_large",
      "Upstream OAuth response exceeded the configured size limit",
      response.status
    );
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw oauthFailure(
          "response_too_large",
          "Upstream OAuth response exceeded the configured size limit",
          response.status
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
  } catch {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned invalid UTF-8",
      response.status
    );
  }
}

function parseOAuthBody(
  text: string,
  contentType: string | null
): Record<string, unknown> {
  const json =
    contentType?.toLowerCase().includes("json") || text.startsWith("{");
  if (json) {
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value)) {
        throw new TypeError();
      }
      return value;
    } catch {
      throw oauthFailure(
        "malformed_response",
        "Upstream OAuth endpoint returned malformed JSON"
      );
    }
  }
  if (!text.includes("=")) {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned an unsupported response body"
    );
  }
  if (/%(?![0-9A-Fa-f]{2})/.test(text)) {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned malformed form encoding"
    );
  }
  const params = new URLSearchParams(text);
  assertNoDuplicateOAuthBodyParams(params);
  return Object.fromEntries(params.entries());
}

function assertNoDuplicateOAuthBodyParams(params: URLSearchParams): void {
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (seen.has(key)) {
      throw oauthFailure(
        "malformed_response",
        "Upstream OAuth endpoint returned duplicate response fields"
      );
    }
    seen.add(key);
  }
}

function parseTokenSet(
  parsed: Record<string, unknown>,
  operation: string
): UpstreamTokenSet {
  const accessToken = parsed.access_token;
  const tokenType = parsed.token_type;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    typeof tokenType !== "string" ||
    tokenType.length === 0
  ) {
    throw oauthFailure(
      "malformed_response",
      `Upstream OAuth ${operation} returned an invalid token response`
    );
  }
  const expiresIn = parseExpiresIn(parsed.expires_in);
  const refreshToken = optionalString(parsed.refresh_token, "refresh_token");
  const scopeValue = optionalString(parsed.scope, "scope");
  let scope: string | undefined;
  if (scopeValue !== undefined) {
    try {
      scope = normalizeScope(scopeValue);
    } catch {
      throw oauthFailure(
        "malformed_response",
        "Upstream OAuth endpoint returned an invalid scope value"
      );
    }
  }
  const idToken = optionalString(parsed.id_token, "id_token");
  return {
    accessToken,
    tokenType,
    ...(expiresIn !== undefined && { expiresIn }),
    ...(refreshToken !== undefined && { refreshToken }),
    ...(scope !== undefined && { scope }),
    ...(idToken !== undefined && { idToken }),
  };
}

function parseExpiresIn(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw oauthFailure(
      "malformed_response",
      "Upstream OAuth endpoint returned an invalid expires_in value"
    );
  }
  return number;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw oauthFailure(
      "malformed_response",
      `Upstream OAuth endpoint returned an invalid ${name} value`
    );
  }
  return value;
}

function providerOAuthError(
  operation: string,
  providerCode: string,
  description: string | undefined,
  status: number | undefined,
  sensitiveValues: readonly (string | undefined)[]
): UpstreamOAuthError {
  const redactedCode = redact(providerCode, sensitiveValues);
  const safeCode =
    redactedCode === providerCode &&
    /^[A-Za-z0-9._~-]{1,128}$/.test(providerCode)
      ? providerCode
      : "upstream_oauth_error";
  const safeDescription =
    description === undefined
      ? undefined
      : redact(description, sensitiveValues).slice(0, 1024);
  return oauthFailure(
    safeCode,
    `Upstream OAuth ${operation} failed (${safeCode})`,
    status,
    safeDescription
  );
}

function redact(
  value: string,
  sensitiveValues: readonly (string | undefined)[]
): string {
  let result = value;
  for (const sensitive of sensitiveValues) {
    if (sensitive !== undefined && sensitive.length > 0) {
      const variants = new Set([
        sensitive,
        encodeURIComponent(sensitive),
        formEncode(sensitive),
        base64Utf8(sensitive),
      ]);
      for (const variant of variants) {
        result = result.replaceAll(variant, "[REDACTED]");
      }
    }
  }
  return result;
}

function transactionSecrets(
  transaction: UpstreamAuthorizationTransaction,
  clientSecret: string | undefined
): (string | undefined)[] {
  return [
    clientSecret,
    transaction.state,
    transaction.codeVerifier,
    transaction.nonce,
  ];
}

function oauthFailure(
  code: string,
  message: string,
  status?: number,
  description?: string
): UpstreamOAuthError {
  return new UpstreamOAuthError(code, message, {
    ...(status !== undefined && { status }),
    ...(description !== undefined && { description }),
  });
}
