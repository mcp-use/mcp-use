import {
  exchangeAuthorization,
  IssuerMismatchError,
  refreshAuthorization,
  startAuthorization,
  validateAuthorizationResponseIssuer,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/client";

import { assertSecureHttpUrl, isRecord, parseAbsoluteUrl } from "../guards.js";
import {
  UpstreamOAuthError,
  UpstreamOAuthHttpClient,
  base64Utf8,
  formEncode,
  oauthFailure,
  providerOAuthError,
} from "./upstream-http.js";
import type {
  UpstreamAuthorizationCodeExchange,
  UpstreamAuthorizationRequest,
  UpstreamAuthorizationResult,
  UpstreamAuthorizationTransaction,
  UpstreamOAuthClientOptions,
  UpstreamRefreshTokenRequest,
  UpstreamTokenEndpointAuthMethod,
  UpstreamTokenSet,
} from "./upstream-types.js";

export { UpstreamOAuthError } from "./upstream-http.js";
export type {
  UpstreamAuthorizationCodeExchange,
  UpstreamAuthorizationRequest,
  UpstreamAuthorizationResult,
  UpstreamAuthorizationTransaction,
  UpstreamOAuthClientOptions,
  UpstreamRefreshTokenRequest,
  UpstreamTokenEndpointAuthMethod,
  UpstreamTokenSet,
} from "./upstream-types.js";

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

/**
 * @internal Fixed-upstream OAuth adapter for the server's proxy. The official
 * client helpers own standard authorization, PKCE, exchange, refresh, issuer,
 * and token-schema behavior; this class supplies proxy policy and I/O limits.
 */
export class UpstreamOAuthClient {
  readonly #authorizationEndpoint: URL;
  readonly #tokenEndpoint: URL;
  readonly #issuer?: string;
  readonly #requireAuthorizationResponseIssuer: boolean;
  readonly #clientInformation: OAuthClientInformationMixed;
  readonly #authMethod: UpstreamTokenEndpointAuthMethod;
  readonly #authorizationParams: Readonly<Record<string, string>>;
  readonly #metadata: AuthorizationServerMetadata;
  readonly #authorizationServerUrl: string;
  readonly #http: UpstreamOAuthHttpClient;
  readonly #crypto: Pick<Crypto, "getRandomValues">;

  /** Validates and stores immutable upstream adapter configuration. */
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
    if (options.issuer !== undefined)
      this.#issuer = parseIssuer(options.issuer);
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

    const clientId = requireNonEmpty(options.clientId, "clientId");
    this.#authMethod = validateAuthMethod(
      options.tokenEndpointAuthMethod,
      options.clientSecret
    );
    const clientInformation = {
      client_id: clientId,
      ...(options.clientSecret === undefined
        ? {}
        : { client_secret: options.clientSecret }),
      token_endpoint_auth_method: this.#authMethod,
    };
    this.#clientInformation = clientInformation;

    this.#authorizationParams = validateAuthorizationParams(
      options.authorizationParams,
      this.#authorizationEndpoint.searchParams
    );
    this.#http = new UpstreamOAuthHttpClient({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: options.maxResponseBytes }),
    });
    this.#crypto = options.crypto ?? globalThis.crypto;
    if (
      this.#crypto === undefined ||
      typeof this.#crypto.getRandomValues !== "function"
    ) {
      throw new TypeError("Web Crypto must be available");
    }

    this.#authorizationServerUrl =
      this.#issuer ?? new URL("/", this.#authorizationEndpoint).href;
    // Fixed endpoints may intentionally be configured without an issuer baseline.
    this.#metadata = {
      issuer: this.#issuer,
      authorization_endpoint: this.#authorizationEndpoint.href,
      token_endpoint: this.#tokenEndpoint.href,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [this.#authMethod],
      ...(this.#requireAuthorizationResponseIssuer
        ? { authorization_response_iss_parameter_supported: true }
        : {}),
    } as AuthorizationServerMetadata;
  }

  /** Builds an authorization URL with proxy-owned state and optional nonce. */
  async createAuthorizationRequest(
    request: UpstreamAuthorizationRequest
  ): Promise<UpstreamAuthorizationResult> {
    const redirectUri = secureRedirectUri(request.redirectUri, "redirectUri");
    const state = randomBase64Url(this.#crypto, 32);
    const nonce = request.includeNonce
      ? randomBase64Url(this.#crypto, 32)
      : undefined;
    const scope = normalizeScope(request.scopes);
    const resource =
      request.resource === undefined
        ? undefined
        : resourceUrl(request.resource);

    let authorizationUrl: URL;
    let codeVerifier: string;
    try {
      ({ authorizationUrl, codeVerifier } = await startAuthorization(
        this.#authorizationServerUrl,
        {
          metadata: this.#metadata,
          clientInformation: this.#clientInformation,
          redirectUrl: redirectUri,
          ...(scope === undefined ? {} : { scope }),
          state,
          ...(resource === undefined ? {} : { resource }),
        }
      ));
    } catch {
      throw oauthFailure(
        "authorization_request_failed",
        "Upstream OAuth authorization request construction failed"
      );
    }
    // The SDK adds prompt=consent for offline_access. Prompt policy belongs to
    // the proxy/provider, so retain only values explicitly configured here.
    authorizationUrl.searchParams.delete("prompt");
    const endpointPrompt =
      this.#authorizationEndpoint.searchParams.get("prompt");
    if (endpointPrompt !== null) {
      authorizationUrl.searchParams.set("prompt", endpointPrompt);
    }
    setParams(authorizationUrl.searchParams, this.#authorizationParams);
    if (nonce !== undefined) authorizationUrl.searchParams.set("nonce", nonce);

    return {
      url: authorizationUrl,
      transaction: {
        state,
        codeVerifier,
        redirectUri,
        ...(resource === undefined ? {} : { resource: resource.href }),
        ...(nonce === undefined ? {} : { nonce }),
      },
    };
  }

  /** Validates proxy bindings and delegates issuer validation and code exchange. */
  async exchangeAuthorizationCode(
    request: UpstreamAuthorizationCodeExchange
  ): Promise<UpstreamTokenSet> {
    const responseParams =
      request.authorizationResponse instanceof URL
        ? request.authorizationResponse.searchParams
        : request.authorizationResponse;
    const sensitive = this.#transactionSecrets(request.transaction);
    const state = singleParam(responseParams, "state");
    if (
      state === undefined ||
      !constantTimeStringEqual(state, request.transaction.state)
    ) {
      throw oauthFailure("state_mismatch", "OAuth state validation failed");
    }
    const returnedIssuer = singleParam(responseParams, "iss");
    this.#validateIssuer(returnedIssuer);

    const callbackError = singleParam(responseParams, "error");
    const code = singleParam(responseParams, "code");
    if (callbackError !== undefined && code !== undefined) {
      throw oauthFailure(
        "invalid_authorization_response",
        "OAuth authorization response contains both code and error"
      );
    }
    if (callbackError !== undefined) {
      throw providerOAuthError(
        "authorization",
        callbackError,
        singleParam(responseParams, "error_description"),
        undefined,
        sensitive
      );
    }
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
    const resource =
      request.resource === undefined
        ? undefined
        : resourceUrl(request.resource);
    if (resource?.href !== request.transaction.resource) {
      throw oauthFailure(
        "resource_mismatch",
        "OAuth token resource does not match the authorization transaction"
      );
    }
    try {
      const tokens = await exchangeAuthorization(this.#authorizationServerUrl, {
        metadata: this.#metadata,
        clientInformation: this.#clientInformation,
        authorizationCode: code,
        ...(returnedIssuer === undefined ? {} : { iss: returnedIssuer }),
        codeVerifier: requireNonEmpty(
          request.transaction.codeVerifier,
          "transaction.codeVerifier"
        ),
        redirectUri,
        ...(resource === undefined ? {} : { resource }),
        addClientAuthentication: this.#addClientAuthentication,
        fetchFn: this.#sdkFetch("token exchange", [...sensitive, code]),
      });
      return normalizeTokenSet(tokens, "token exchange");
    } catch (error) {
      throw normalizeHelperError(error, "token exchange");
    }
  }

  /** Delegates refresh construction, rotation, and token parsing to the SDK. */
  async refreshToken(
    request: UpstreamRefreshTokenRequest
  ): Promise<UpstreamTokenSet> {
    const refreshToken = requireNonEmpty(request.refreshToken, "refreshToken");
    const resource =
      request.resource === undefined
        ? undefined
        : resourceUrl(request.resource);

    try {
      const tokens = await refreshAuthorization(this.#authorizationServerUrl, {
        metadata: this.#metadata,
        clientInformation: this.#clientInformation,
        refreshToken,
        ...(resource === undefined ? {} : { resource }),
        addClientAuthentication: this.#addClientAuthentication,
        fetchFn: this.#sdkFetch("token refresh", [
          ...this.#clientAuthenticationSecrets(),
          refreshToken,
        ]),
      });
      return normalizeTokenSet(tokens, "token refresh");
    } catch (error) {
      throw normalizeHelperError(error, "token refresh");
    }
  }

  /** Validates a nonce only against claims already verified by the caller. */
  validateVerifiedIdTokenClaims(
    transaction: UpstreamAuthorizationTransaction,
    verifiedClaims: Readonly<Record<string, unknown>>
  ): void {
    if (transaction.nonce === undefined) return;
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

  readonly #addClientAuthentication = (
    headers: Headers,
    params: URLSearchParams
  ): void => {
    if (this.#authMethod === "client_secret_basic") {
      headers.set("authorization", this.#basicAuthorization()!);
    } else if (this.#authMethod === "client_secret_post") {
      params.set("client_id", this.#clientInformation.client_id);
      params.set("client_secret", this.#clientInformation.client_secret!);
    } else {
      params.set("client_id", this.#clientInformation.client_id);
    }
  };

  #sdkFetch(
    operation: string,
    sensitiveValues: readonly (string | undefined)[]
  ): FetchLike {
    return async (input, init) => {
      const endpoint = input instanceof Request ? input.url : String(input);
      if (endpoint !== this.#tokenEndpoint.href) {
        throw oauthFailure(
          "unexpected_endpoint",
          `Upstream OAuth ${operation} targeted an unexpected endpoint`
        );
      }
      if (!(init?.body instanceof URLSearchParams)) {
        throw oauthFailure(
          "invalid_request",
          `Upstream OAuth ${operation} produced an invalid request body`
        );
      }
      const params = new URLSearchParams(init.body);
      const parsed = await this.#http.postForm({
        endpoint: this.#tokenEndpoint,
        params,
        headers: new Headers(init.headers),
        operation,
        sensitiveValues,
      });
      assertSafeTokenResponseCoercion(parsed, operation);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
  }

  #validateIssuer(returnedIssuer: string | undefined): void {
    try {
      validateAuthorizationResponseIssuer({
        iss: returnedIssuer,
        expectedIssuer: this.#issuer,
        issParameterSupported: this.#requireAuthorizationResponseIssuer,
      });
    } catch (error) {
      if (error instanceof IssuerMismatchError) {
        throw oauthFailure(
          "issuer_mismatch",
          "OAuth authorization-response issuer validation failed"
        );
      }
      throw error;
    }
  }

  #basicAuthorization(): string | undefined {
    const clientSecret = this.#clientInformation.client_secret;
    if (
      this.#authMethod !== "client_secret_basic" ||
      clientSecret === undefined
    ) {
      return undefined;
    }
    const credentials = `${formEncode(this.#clientInformation.client_id)}:${formEncode(clientSecret)}`;
    return `Basic ${base64Utf8(credentials)}`;
  }

  #clientAuthenticationSecrets(): (string | undefined)[] {
    const clientSecret = this.#clientInformation.client_secret;
    const basicAuthorization = this.#basicAuthorization();
    return [
      clientSecret,
      basicAuthorization,
      basicAuthorization?.slice("Basic ".length),
      clientSecret === undefined
        ? undefined
        : `${this.#clientInformation.client_id}:${clientSecret}`,
    ];
  }

  #transactionSecrets(
    transaction: UpstreamAuthorizationTransaction
  ): (string | undefined)[] {
    return [
      ...this.#clientAuthenticationSecrets(),
      transaction.state,
      transaction.codeVerifier,
      transaction.nonce,
    ];
  }
}

function validateAuthMethod(
  method: UpstreamTokenEndpointAuthMethod,
  clientSecret: string | undefined
): UpstreamTokenEndpointAuthMethod {
  if (
    method !== "client_secret_basic" &&
    method !== "client_secret_post" &&
    method !== "none"
  ) {
    throw new TypeError("tokenEndpointAuthMethod is not supported");
  }
  if (method === "none") {
    if (clientSecret !== undefined) {
      throw new TypeError(
        "clientSecret must be omitted when tokenEndpointAuthMethod is none"
      );
    }
  } else {
    requireNonEmpty(clientSecret, "clientSecret");
  }
  return method;
}

function parseEndpoint(
  value: string | URL,
  name: string,
  reservedParams: ReadonlySet<string>
): URL {
  const url = parseAbsoluteUrl(value, name);
  assertSecureHttpUrl(url, name);
  if (url.hash !== "")
    throw new TypeError(`${name} must not include a fragment`);
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
  const original = String(value);
  const url = parseAbsoluteUrl(value, "issuer");
  assertSecureHttpUrl(url, "issuer");
  if (url.search !== "" || url.hash !== "") {
    throw new TypeError("issuer must not include a query string or fragment");
  }
  return original;
}

function secureRedirectUri(value: string | URL, name: string): string {
  const original = String(value);
  const url = parseAbsoluteUrl(value, name);
  assertSecureHttpUrl(url, name);
  if (url.hash !== "")
    throw new TypeError(`${name} must not include a fragment`);
  return original;
}

function resourceUrl(value: string | URL): URL {
  const url = parseAbsoluteUrl(value, "resource");
  assertSecureHttpUrl(url, "resource");
  if (url.hash !== "")
    throw new TypeError("resource must not include a fragment");
  return url;
}

function validateAuthorizationParams(
  value: Readonly<Record<string, string>> | undefined,
  endpointParams: URLSearchParams
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new TypeError(
      "authorizationParams must be an object of string values"
    );
  }
  const result: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, entry] of Object.entries(value)) {
    if (key.length === 0 || typeof entry !== "string") {
      throw new TypeError(
        "authorizationParams must contain non-empty keys and string values"
      );
    }
    if (AUTHORIZATION_RESERVED_PARAMS.has(key)) {
      throw new TypeError(
        `authorizationParams must not set reserved parameter ${key}`
      );
    }
    if (endpointParams.has(key)) {
      throw new TypeError(
        `authorizationParams parameter ${key} collides with configured parameters`
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
  for (const [key, value] of Object.entries(values)) params.set(key, value);
}

function normalizeScope(
  value: string | readonly string[] | undefined
): string | undefined {
  if (value === undefined) return undefined;
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
    if (seen.has(member))
      throw new TypeError("scopes must not contain duplicate values");
    seen.add(member);
  }
  return members.join(" ");
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
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
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

function normalizeTokenSet(
  tokens: OAuthTokens,
  operation: string
): UpstreamTokenSet {
  const accessToken = tokenString(
    tokens.access_token,
    "access_token",
    operation
  );
  const tokenType = tokenString(tokens.token_type, "token_type", operation);
  const expiresIn = tokens.expires_in;
  if (
    expiresIn !== undefined &&
    (!Number.isSafeInteger(expiresIn) || expiresIn < 0)
  ) {
    throw invalidTokenResponse(operation, "expires_in");
  }
  const refreshToken = optionalTokenString(
    tokens.refresh_token,
    "refresh_token",
    operation
  );
  const idToken = optionalTokenString(tokens.id_token, "id_token", operation);
  let scope: string | undefined;
  if (tokens.scope !== undefined) {
    try {
      scope = normalizeScope(tokenString(tokens.scope, "scope", operation));
    } catch (error) {
      if (error instanceof UpstreamOAuthError) throw error;
      throw invalidTokenResponse(operation, "scope");
    }
  }
  return {
    accessToken,
    tokenType,
    ...(expiresIn === undefined ? {} : { expiresIn }),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(scope === undefined ? {} : { scope }),
    ...(idToken === undefined ? {} : { idToken }),
  };
}

function assertSafeTokenResponseCoercion(
  parsed: Readonly<Record<string, unknown>>,
  operation: string
): void {
  const expiresIn = parsed.expires_in;
  if (
    expiresIn !== undefined &&
    typeof expiresIn !== "number" &&
    !(typeof expiresIn === "string" && /^\d+$/.test(expiresIn))
  ) {
    throw invalidTokenResponse(operation, "expires_in");
  }
}

function tokenString(value: unknown, field: string, operation: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidTokenResponse(operation, field);
  }
  return value;
}

function optionalTokenString(
  value: unknown,
  field: string,
  operation: string
): string | undefined {
  return value === undefined ? undefined : tokenString(value, field, operation);
}

function invalidTokenResponse(
  operation: string,
  field: string
): UpstreamOAuthError {
  return oauthFailure(
    "malformed_response",
    `Upstream OAuth ${operation} returned an invalid ${field}`
  );
}

function normalizeHelperError(
  error: unknown,
  operation: string
): UpstreamOAuthError {
  if (error instanceof UpstreamOAuthError) return error;
  if (error instanceof IssuerMismatchError) {
    return oauthFailure(
      "issuer_mismatch",
      "OAuth authorization-response issuer validation failed"
    );
  }
  if (isRecord(error) && error.name === "ZodError") {
    return oauthFailure(
      "malformed_response",
      `Upstream OAuth ${operation} returned an invalid token response`
    );
  }
  return oauthFailure(
    "upstream_oauth_error",
    `Upstream OAuth ${operation} failed`
  );
}
