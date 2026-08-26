import {
  OAuthClientInformationFullSchema,
  OAuthClientMetadataSchema,
  OAuthClientRegistrationErrorSchema,
  OAuthErrorResponseSchema,
  OAuthTokenRevocationRequestSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/core";

import type { FetchMiddleware } from "../../fetch-app.js";
import {
  OAuthAuthorizationCore,
  OAuthAuthorizationCoreError,
  type LocalOAuthTokenSet,
} from "./authorization-core.js";
import type { OAuthProxyJsonObject } from "./authorization-records.js";
import {
  UpstreamOAuthClient,
  UpstreamOAuthError,
  type UpstreamTokenSet,
} from "./upstream-client.js";

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const BROWSER_COOKIE = "mcp_oauth_browser";
const HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const SCOPE_PATTERN = /^[\u0021\u0023-\u005B\u005D-\u007E]+$/u;
const encoder = new TextEncoder();

type CryptoImplementation = Pick<Crypto, "getRandomValues">;

/** @internal Provider-specific context for an explicit upstream resource mapping. */
export interface OAuthProxyUpstreamResourceContext {
  readonly phase: "authorization" | "refresh";
  readonly localResource: string;
  readonly scopes: readonly string[];
  readonly userPayload?: OAuthProxyJsonObject;
}

/** @internal Options for the embedded OAuth proxy's Web-standard route middleware. */
export interface OAuthAuthorizationRoutesOptions {
  /** Exact local OAuth issuer URL. */
  readonly issuer: string | URL;
  /** Exact canonical MCP resource URL accepted from downstream clients. */
  readonly resource: string | URL;
  /** Exact route prefix mounted by the caller, for example `/oauth`. */
  readonly prefix: string;
  /** Locally grantable downstream scopes. */
  readonly scopes: readonly string[];
  /** Persistence-backed local authorization server state machine. */
  readonly core: OAuthAuthorizationCore;
  /** Narrow client for the shared upstream OAuth application. */
  readonly upstreamClient: UpstreamOAuthClient;
  /** Scopes requested from the upstream provider; defaults to the local scopes. */
  readonly upstreamScopes?: readonly string[];
  /** Verifies the upstream access token and returns persistable trusted identity data. */
  readonly verifyToken: (
    accessToken: string
  ) => OAuthProxyJsonObject | Promise<OAuthProxyJsonObject>;
  /**
   * Verifies an upstream ID token. Its claims are only used for nonce validation
   * after this hook has established signature, issuer, and audience trust.
   */
  readonly verifyIdToken?: (
    idToken: string,
    tokens: UpstreamTokenSet
  ) =>
    | Readonly<Record<string, unknown>>
    | Promise<Readonly<Record<string, unknown>>>;
  /** Explicit provider-specific mapping; the MCP resource is never forwarded implicitly. */
  readonly mapUpstreamResource?: (
    context: OAuthProxyUpstreamResourceContext
  ) => string | URL | undefined | Promise<string | URL | undefined>;
  /** Additional redirect policy applied after the secure exact-URI defaults. */
  readonly validateRedirectUri?: (
    redirectUri: URL
  ) => boolean | void | Promise<boolean | void>;
  /** Web Crypto seam used only for the stable browser-binding cookie. */
  readonly crypto?: CryptoImplementation;
  /** Clock seam used for translating upstream token lifetimes. */
  readonly now?: () => number;
  /** Maximum accepted registration and form body size. */
  readonly maxBodyBytes?: number;
}

interface ResolvedOptions extends Omit<
  OAuthAuthorizationRoutesOptions,
  "issuer" | "resource" | "prefix" | "scopes" | "upstreamScopes"
> {
  readonly issuer: URL;
  readonly resource: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly scopeSet: ReadonlySet<string>;
  readonly upstreamScopes: readonly string[];
  readonly callbackUri: string;
  readonly crypto: CryptoImplementation;
  readonly now: () => number;
  readonly maxBodyBytes: number;
}

/**
 * @internal Creates the embedded OAuth proxy routes without coupling them to
 * the public provider factory or Hono. Non-owned paths fall through to `next`.
 */
export function createOAuthAuthorizationRoutes(
  options: OAuthAuthorizationRoutesOptions
): FetchMiddleware {
  const resolved = resolveOptions(options);
  const paths = new Map<string, ReadonlySet<string>>([
    [`${resolved.prefix}/register`, new Set(["POST"])],
    [`${resolved.prefix}/authorize`, new Set(["GET", "POST"])],
    [`${resolved.prefix}/callback`, new Set(["GET"])],
    [`${resolved.prefix}/token`, new Set(["POST"])],
    [`${resolved.prefix}/revoke`, new Set(["POST"])],
  ]);

  return async (request, next) => {
    const url = new URL(request.url);
    const methods = paths.get(url.pathname);
    if (methods === undefined) return next();
    if (!methods.has(request.method)) {
      return ownedResponse("Method Not Allowed", {
        status: 405,
        headers: { Allow: Array.from(methods).join(", ") },
      });
    }

    try {
      switch (`${request.method} ${url.pathname}`) {
        case `POST ${resolved.prefix}/register`:
          return await register(request, resolved);
        case `GET ${resolved.prefix}/authorize`:
          return await authorizeGet(request, url, resolved);
        case `POST ${resolved.prefix}/authorize`:
          return await authorizePost(request, resolved);
        case `GET ${resolved.prefix}/callback`:
          return await callback(request, url, resolved);
        case `POST ${resolved.prefix}/token`:
          return await token(request, resolved);
        case `POST ${resolved.prefix}/revoke`:
          return await revoke(request, resolved);
        default:
          return ownedResponse("Not Found", { status: 404 });
      }
    } catch (error) {
      return routeFailure(error);
    }
  };
}

async function register(
  request: Request,
  options: ResolvedOptions
): Promise<Response> {
  if (!isMediaType(request, "application/json")) {
    return registrationError("invalid_client_metadata", 415);
  }
  let parsedBody: unknown;
  try {
    parsedBody = await readJson(request, options.maxBodyBytes);
  } catch (error) {
    if (error instanceof RouteOAuthError) {
      return registrationError("invalid_client_metadata", error.status);
    }
    throw error;
  }
  const parsed = OAuthClientMetadataSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return registrationError("invalid_client_metadata", 400);
  }
  const metadata = parsed.data;
  if (
    !hasOnlyKeys(parsedBody, [
      "redirect_uris",
      "token_endpoint_auth_method",
      "grant_types",
      "response_types",
      "application_type",
      "client_name",
      "client_uri",
      "logo_uri",
      "scope",
      "contacts",
      "tos_uri",
      "policy_uri",
      "software_id",
      "software_version",
      "software_statement",
    ]) ||
    (metadata.token_endpoint_auth_method !== undefined &&
      metadata.token_endpoint_auth_method !== "none") ||
    (metadata.grant_types !== undefined &&
      !isSupportedSet(metadata.grant_types, [
        "authorization_code",
        "refresh_token",
      ])) ||
    (metadata.response_types !== undefined &&
      !isSupportedSet(metadata.response_types, ["code"])) ||
    (metadata.application_type !== undefined &&
      metadata.application_type !== "native" &&
      metadata.application_type !== "web")
  ) {
    return registrationError("invalid_client_metadata", 400);
  }

  const redirectUris = metadata.redirect_uris;
  if (
    redirectUris.length === 0 ||
    redirectUris.length > 32 ||
    new Set(redirectUris).size !== redirectUris.length
  ) {
    return registrationError("invalid_redirect_uri", 400);
  }
  try {
    for (const value of redirectUris) {
      const redirectUri = validateRedirectUri(value);
      const hookResult = await options.validateRedirectUri?.(redirectUri);
      if (hookResult === false) throw new InvalidRedirectUriError();
    }
  } catch {
    return registrationError("invalid_redirect_uri", 400);
  }

  let registeredScopes: string[];
  try {
    registeredScopes =
      metadata.scope === undefined || metadata.scope === ""
        ? [...options.scopes]
        : parseScope(metadata.scope, options.scopeSet);
  } catch {
    return registrationError("invalid_client_metadata", 400);
  }
  if (metadata.client_name !== undefined) {
    if (
      metadata.client_name.length === 0 ||
      encoder.encode(metadata.client_name).byteLength > 512
    ) {
      return registrationError("invalid_client_metadata", 400);
    }
  }

  const registered = await options.core.registerClient({
    redirectUris,
    ...(metadata.client_name === undefined
      ? {}
      : { clientName: metadata.client_name }),
    ...(registeredScopes.length === 0
      ? {}
      : { scope: registeredScopes.join(" ") }),
  });
  const output = OAuthClientInformationFullSchema.parse({
    redirect_uris: registered.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...(registered.clientName === undefined
      ? {}
      : { client_name: registered.clientName }),
    ...(registered.scope === undefined ? {} : { scope: registered.scope }),
    client_id: registered.clientId,
    client_id_issued_at: Math.floor(registered.createdAt / 1000),
  });
  return jsonResponse(output, 201, true);
}

async function authorizeGet(
  _request: Request,
  url: URL,
  options: ResolvedOptions
): Promise<Response> {
  const params = strictParams(url.searchParams, [
    "response_type",
    "client_id",
    "redirect_uri",
    "state",
    "resource",
    "scope",
    "code_challenge",
    "code_challenge_method",
  ]);
  if (
    params.response_type !== "code" ||
    params.state === undefined ||
    params.state.length === 0 ||
    params.state.length > 2048 ||
    params.client_id === undefined ||
    !HANDLE_PATTERN.test(params.client_id) ||
    params.redirect_uri === undefined ||
    params.resource !== options.resource ||
    params.code_challenge_method !== "S256" ||
    params.code_challenge === undefined ||
    !PKCE_CHALLENGE_PATTERN.test(params.code_challenge)
  ) {
    throw new RouteOAuthError("invalid_request", 400);
  }
  const client = await options.core.getClient(params.client_id);
  if (
    client === undefined ||
    !client.redirectUris.includes(params.redirect_uri)
  ) {
    throw new RouteOAuthError("invalid_client", 400);
  }
  const clientScopes = new Set(
    parseScope(client.scope ?? "", options.scopeSet)
  );
  const requestedScopes = parseScope(params.scope ?? "", options.scopeSet);
  if (requestedScopes.some((scope) => !clientScopes.has(scope))) {
    throw new RouteOAuthError("invalid_scope", 400);
  }

  const browser = browserBinding(_request, options);
  const transaction = await options.core.createConsentTransaction({
    clientId: client.clientId,
    redirectUri: params.redirect_uri,
    resource: options.resource,
    scopes: requestedScopes,
    downstreamState: params.state,
    codeChallenge: params.code_challenge,
    browserBinding: browser.value,
  });
  const html = consentHtml({
    clientName: client.clientName ?? "MCP client",
    clientId: client.clientId,
    resource: options.resource,
    scopes: requestedScopes,
    transactionId: transaction.transactionId,
    csrfToken: transaction.csrfToken,
    action: `${options.prefix}/authorize`,
  });
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (browser.setCookie !== undefined) {
    headers.append("Set-Cookie", browser.setCookie);
  }
  return ownedResponse(html, { status: 200, headers });
}

async function authorizePost(
  request: Request,
  options: ResolvedOptions
): Promise<Response> {
  const form = await readForm(request, options.maxBodyBytes);
  const params = strictParams(form, [
    "transaction_id",
    "csrf_token",
    "decision",
  ]);
  if (
    params.transaction_id === undefined ||
    !HANDLE_PATTERN.test(params.transaction_id) ||
    params.csrf_token === undefined ||
    !HANDLE_PATTERN.test(params.csrf_token) ||
    (params.decision !== "approve" && params.decision !== "deny")
  ) {
    throw new RouteOAuthError("invalid_request", 400);
  }
  const browser = requireBrowserBinding(request);
  const consent = await options.core.consumeConsentTransaction({
    transactionId: params.transaction_id,
    csrfToken: params.csrf_token,
    browserBinding: browser,
  });
  if (params.decision === "deny") {
    return downstreamRedirect(consent.redirectUri, {
      error: "access_denied",
      state: consent.downstreamState,
    });
  }

  const upstreamResource = await mapUpstreamResource(options, {
    phase: "authorization",
    localResource: consent.resource,
    scopes: consent.scopes,
  });
  const authorization = await options.upstreamClient.createAuthorizationRequest(
    {
      redirectUri: options.callbackUri,
      scopes: options.upstreamScopes,
      includeNonce: options.verifyIdToken !== undefined,
      ...(upstreamResource === undefined ? {} : { resource: upstreamResource }),
    }
  );
  await options.core.createUpstreamCallbackTransaction({
    upstreamState: authorization.transaction.state,
    clientId: consent.clientId,
    redirectUri: consent.redirectUri,
    resource: consent.resource,
    scopes: consent.scopes,
    downstreamState: consent.downstreamState,
    downstreamCodeChallenge: consent.codeChallenge,
    browserBinding: browser,
    upstreamCodeVerifier: authorization.transaction.codeVerifier,
    upstreamRedirectUri: authorization.transaction.redirectUri,
    ...(authorization.transaction.nonce === undefined
      ? {}
      : { upstreamNonce: authorization.transaction.nonce }),
    ...(authorization.transaction.resource === undefined
      ? {}
      : { upstreamResource: authorization.transaction.resource }),
  });
  return redirect(authorization.url.toString());
}

async function callback(
  request: Request,
  url: URL,
  options: ResolvedOptions
): Promise<Response> {
  const callbackParams = strictParams(url.searchParams, [
    "state",
    "code",
    "iss",
    "error",
    "error_description",
    "error_uri",
  ]);
  if (
    callbackParams.state === undefined ||
    !HANDLE_PATTERN.test(callbackParams.state)
  ) {
    throw new RouteOAuthError("invalid_request", 400);
  }
  const browser = requireBrowserBinding(request);
  const callbackState = await options.core.consumeUpstreamCallbackTransaction({
    state: callbackParams.state,
    browserBinding: browser,
  });
  try {
    const transaction = {
      state: callbackParams.state,
      codeVerifier: callbackState.upstreamCodeVerifier,
      redirectUri: callbackState.upstreamRedirectUri,
      ...(callbackState.upstreamNonce === undefined
        ? {}
        : { nonce: callbackState.upstreamNonce }),
      ...(callbackState.upstreamResource === undefined
        ? {}
        : { resource: callbackState.upstreamResource }),
    };
    const tokens = await options.upstreamClient.exchangeAuthorizationCode({
      authorizationResponse: url.searchParams,
      transaction,
      ...(callbackState.upstreamResource === undefined
        ? {}
        : { resource: callbackState.upstreamResource }),
    });
    if (callbackState.upstreamNonce !== undefined) {
      if (tokens.idToken === undefined || options.verifyIdToken === undefined) {
        throw new RouteOAuthError("server_error", 502);
      }
      const claims = await options.verifyIdToken(tokens.idToken, tokens);
      options.upstreamClient.validateVerifiedIdTokenClaims(transaction, claims);
    }
    const userPayload = await options.verifyToken(tokens.accessToken);
    const grant = await options.core.persistGrantAndIssueAuthorizationCode({
      clientId: callbackState.clientId,
      redirectUri: callbackState.redirectUri,
      resource: callbackState.resource,
      scopes: callbackState.scopes,
      codeChallenge: callbackState.downstreamCodeChallenge,
      grant: {
        tokens: storedTokenSet(tokens, options.now()),
        userPayload,
      },
    });
    return downstreamRedirect(callbackState.redirectUri, {
      code: grant.code,
      state: callbackState.downstreamState,
    });
  } catch (error) {
    return downstreamRedirect(callbackState.redirectUri, {
      error:
        error instanceof UpstreamOAuthError && error.code === "access_denied"
          ? "access_denied"
          : "server_error",
      state: callbackState.downstreamState,
    });
  }
}

async function token(
  request: Request,
  options: ResolvedOptions
): Promise<Response> {
  if (request.headers.has("Authorization")) {
    throw new RouteOAuthError("invalid_client", 401);
  }
  const form = await readForm(request, options.maxBodyBytes);
  const params = strictParams(form, [
    "grant_type",
    "client_id",
    "client_secret",
    "code",
    "redirect_uri",
    "code_verifier",
    "refresh_token",
    "resource",
  ]);
  if (
    params.client_secret !== undefined ||
    params.client_id === undefined ||
    !HANDLE_PATTERN.test(params.client_id)
  ) {
    throw new RouteOAuthError("invalid_client", 401);
  }
  if (params.resource !== options.resource) {
    throw new RouteOAuthError("invalid_target", 400);
  }
  const client = await options.core.getClient(params.client_id);
  if (client === undefined) throw new RouteOAuthError("invalid_client", 401);

  let result: LocalOAuthTokenSet;
  if (params.grant_type === "authorization_code") {
    if (
      params.code === undefined ||
      !HANDLE_PATTERN.test(params.code) ||
      params.redirect_uri === undefined ||
      params.code_verifier === undefined ||
      !PKCE_VERIFIER_PATTERN.test(params.code_verifier) ||
      !client.redirectUris.includes(params.redirect_uri) ||
      params.refresh_token !== undefined
    ) {
      throw new RouteOAuthError("invalid_grant", 400);
    }
    result = await options.core.exchangeAuthorizationCode({
      code: params.code,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      resource: options.resource,
      codeVerifier: params.code_verifier,
    });
  } else if (params.grant_type === "refresh_token") {
    if (
      params.refresh_token === undefined ||
      !HANDLE_PATTERN.test(params.refresh_token) ||
      params.code !== undefined ||
      params.redirect_uri !== undefined ||
      params.code_verifier !== undefined
    ) {
      throw new RouteOAuthError("invalid_grant", 400);
    }
    result = await refresh(params.refresh_token, params.client_id, options);
  } else {
    throw new RouteOAuthError("unsupported_grant_type", 400);
  }
  const output = OAuthTokensSchema.parse({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: result.tokenType,
    expires_in: result.expiresIn,
    scope: result.scope,
  });
  return jsonResponse(output, 200, true);
}

async function refresh(
  refreshToken: string,
  clientId: string,
  options: ResolvedOptions
): Promise<LocalOAuthTokenSet> {
  const binding = {
    refreshToken,
    clientId,
    resource: options.resource,
  };
  try {
    return await options.core.rotateRefreshToken(binding);
  } catch (error) {
    if (
      !(error instanceof OAuthAuthorizationCoreError) ||
      error.code !== "upstream_reauthorization_required"
    ) {
      throw error;
    }
  }

  const attempt = await options.core.beginUpstreamRefresh(binding);
  if (attempt.upstreamTokens.refreshToken === undefined) {
    await options.core.markUpstreamRefreshAmbiguous({
      attemptToken: attempt.attemptToken,
    });
    throw new RouteOAuthError("invalid_grant", 400);
  }
  try {
    const upstreamResource = await mapUpstreamResource(options, {
      phase: "refresh",
      localResource: attempt.resource,
      scopes: attempt.scopes,
      userPayload: attempt.userPayload,
    });
    const tokens = await options.upstreamClient.refreshToken({
      refreshToken: attempt.upstreamTokens.refreshToken,
      ...(upstreamResource === undefined ? {} : { resource: upstreamResource }),
    });
    const updatedTokens =
      tokens.scope === undefined && attempt.upstreamTokens.scope !== undefined
        ? { ...tokens, scope: attempt.upstreamTokens.scope }
        : tokens;
    const userPayload = await options.verifyToken(tokens.accessToken);
    return await options.core.completeUpstreamRefresh({
      attemptToken: attempt.attemptToken,
      updatedGrant: {
        tokens: storedTokenSet(updatedTokens, options.now()),
        userPayload,
      },
    });
  } catch (error) {
    await options.core.markUpstreamRefreshAmbiguous({
      attemptToken: attempt.attemptToken,
    });
    throw error;
  }
}

async function revoke(
  request: Request,
  options: ResolvedOptions
): Promise<Response> {
  // RFC 7009 is deliberately enumeration-safe. Malformed token values and
  // incorrect hints receive the same success response as unknown tokens.
  if (request.headers.has("Authorization")) {
    return ownedResponse(null, { status: 200, headers: protocolHeaders(true) });
  }
  let form: URLSearchParams;
  try {
    form = await readForm(request, options.maxBodyBytes);
  } catch {
    return ownedResponse(null, { status: 200, headers: protocolHeaders(true) });
  }
  let params: Record<string, string | undefined>;
  try {
    params = strictParams(form, ["token", "token_type_hint", "client_id"]);
  } catch {
    return ownedResponse(null, { status: 200, headers: protocolHeaders(true) });
  }
  const parsed = OAuthTokenRevocationRequestSchema.safeParse({
    token: params.token,
    ...(params.token_type_hint === undefined
      ? {}
      : { token_type_hint: params.token_type_hint }),
  });
  if (
    parsed.success &&
    (params.client_id === undefined ||
      !HANDLE_PATTERN.test(params.client_id) ||
      (await options.core.getClient(params.client_id)) !== undefined)
  ) {
    await options.core.revokeLocalToken({
      token: parsed.data.token,
      ...(parsed.data.token_type_hint === undefined
        ? {}
        : { tokenTypeHint: parsed.data.token_type_hint }),
    });
  }
  return ownedResponse(null, { status: 200, headers: protocolHeaders(true) });
}

function resolveOptions(
  options: OAuthAuthorizationRoutesOptions
): ResolvedOptions {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("OAuth authorization route options must be an object");
  }
  const issuer = secureUrl(options.issuer, "issuer");
  if (issuer.search !== "") {
    throw new TypeError("OAuth issuer must not contain a query");
  }
  const resource = secureUrl(options.resource, "resource").toString();
  const prefix = normalizePrefix(options.prefix);
  if (issuer.pathname !== prefix && issuer.pathname !== `${prefix}/`) {
    throw new TypeError("OAuth issuer pathname must match the route prefix");
  }
  const scopes = normalizeConfiguredScopes(options.scopes, "scopes");
  const upstreamScopes = normalizeConfiguredScopes(
    options.upstreamScopes ?? scopes,
    "upstreamScopes"
  );
  if (!(options.core instanceof OAuthAuthorizationCore)) {
    throw new TypeError("core must be an OAuthAuthorizationCore");
  }
  if (!(options.upstreamClient instanceof UpstreamOAuthClient)) {
    throw new TypeError("upstreamClient must be an UpstreamOAuthClient");
  }
  if (typeof options.verifyToken !== "function") {
    throw new TypeError("verifyToken must be a function");
  }
  if (
    options.verifyIdToken !== undefined &&
    typeof options.verifyIdToken !== "function"
  ) {
    throw new TypeError("verifyIdToken must be a function");
  }
  if (
    options.mapUpstreamResource !== undefined &&
    typeof options.mapUpstreamResource !== "function"
  ) {
    throw new TypeError("mapUpstreamResource must be a function");
  }
  const crypto = options.crypto ?? globalThis.crypto;
  if (typeof crypto?.getRandomValues !== "function") {
    throw new TypeError("OAuth authorization routes require Web Crypto");
  }
  const now = options.now ?? Date.now;
  const maxBodyBytes = positiveInteger(
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    "maxBodyBytes"
  );
  const callbackUri = new URL(`${prefix}/callback`, issuer.origin).toString();
  return {
    ...options,
    issuer,
    resource,
    prefix,
    scopes,
    scopeSet: new Set(scopes),
    upstreamScopes,
    callbackUri,
    crypto,
    now,
    maxBodyBytes,
  };
}

async function mapUpstreamResource(
  options: ResolvedOptions,
  context: OAuthProxyUpstreamResourceContext
): Promise<string | URL | undefined> {
  return options.mapUpstreamResource?.(context);
}

function storedTokenSet(tokens: UpstreamTokenSet, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("OAuth authorization route clock is invalid");
  }
  return {
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType,
    ...(tokens.expiresIn === undefined
      ? {}
      : { accessTokenExpiresAt: now + tokens.expiresIn * 1000 }),
    ...(tokens.refreshToken === undefined
      ? {}
      : { refreshToken: tokens.refreshToken }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
    ...(tokens.idToken === undefined ? {} : { idToken: tokens.idToken }),
  };
}

function browserBinding(
  request: Request,
  options: ResolvedOptions
): { value: string; setCookie?: string } {
  const existing = readCookie(request.headers.get("Cookie"), BROWSER_COOKIE);
  if (existing !== undefined && HANDLE_PATTERN.test(existing)) {
    return { value: existing };
  }
  const bytes = new Uint8Array(32);
  options.crypto.getRandomValues(bytes);
  const value = base64Url(bytes);
  const secure = options.issuer.protocol === "https:" ? "; Secure" : "";
  return {
    value,
    setCookie: `${BROWSER_COOKIE}=${value}; Path=${options.prefix}; HttpOnly; SameSite=Lax${secure}`,
  };
}

function requireBrowserBinding(request: Request): string {
  const value = readCookie(request.headers.get("Cookie"), BROWSER_COOKIE);
  if (value === undefined || !HANDLE_PATTERN.test(value)) {
    throw new RouteOAuthError("invalid_request", 400);
  }
  return value;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (header === null || header.length > 8192) return undefined;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    if (found !== undefined) return undefined;
    found = part.slice(index + 1).trim();
  }
  return found;
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const text = await readBoundedBody(request, limit);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RouteRegistrationError("invalid_client_metadata", 400);
  }
}

async function readForm(
  request: Request,
  limit: number
): Promise<URLSearchParams> {
  if (!isMediaType(request, "application/x-www-form-urlencoded")) {
    throw new RouteOAuthError("invalid_request", 415);
  }
  return new URLSearchParams(await readBoundedBody(request, limit));
}

async function readBoundedBody(
  request: Request,
  limit: number
): Promise<string> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > limit) {
      throw new RouteOAuthError("invalid_request", 413);
    }
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new RouteOAuthError("invalid_request", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RouteOAuthError("invalid_request", 400);
  }
}

function strictParams(
  params: URLSearchParams,
  allowed: readonly string[]
): Record<string, string | undefined> {
  const allowedSet = new Set(allowed);
  const output: Record<string, string | undefined> = {};
  for (const [key, value] of params) {
    if (!allowedSet.has(key) || output[key] !== undefined) {
      throw new RouteOAuthError("invalid_request", 400);
    }
    output[key] = value;
  }
  return output;
}

function parseScope(value: string, supported: ReadonlySet<string>): string[] {
  if (value === "") return [];
  if (value.length > 4096) throw new RouteOAuthError("invalid_scope", 400);
  const scopes = value.split(" ");
  if (
    scopes.length > 256 ||
    scopes.some(
      (scope) =>
        scope.length === 0 ||
        !SCOPE_PATTERN.test(scope) ||
        !supported.has(scope)
    ) ||
    new Set(scopes).size !== scopes.length
  ) {
    throw new RouteOAuthError("invalid_scope", 400);
  }
  return scopes;
}

function validateRedirectUri(value: string): URL {
  if (value.includes("*") || value.length > 4096) {
    throw new InvalidRedirectUriError();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidRedirectUriError();
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.origin === "null" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) ||
    decodeURIComponentSafely(url.pathname + url.search).includes("*")
  ) {
    throw new InvalidRedirectUriError();
  }
  return url;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(normalized);
  return (
    match !== null &&
    match.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255)
  );
}

function secureUrl(value: string | URL, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.origin === "null" ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))
  ) {
    throw new TypeError(`${name} must use HTTPS, or HTTP for loopback`);
  }
  return url;
}

function normalizePrefix(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/u.test(value) ||
    value === "/"
  ) {
    throw new TypeError(
      "prefix must be a non-root absolute path without a trailing slash"
    );
  }
  return value;
}

function normalizeConfiguredScopes(
  value: readonly string[],
  name: string
): readonly string[] {
  const candidate: unknown = value;
  if (!isUnknownArray(candidate) || candidate.length > 256) {
    throw new TypeError(`${name} must contain unique OAuth scope values`);
  }
  const normalized: string[] = [];
  for (const scope of candidate) {
    if (
      typeof scope !== "string" ||
      scope.length === 0 ||
      !SCOPE_PATTERN.test(scope)
    ) {
      throw new TypeError(`${name} must contain unique OAuth scope values`);
    }
    normalized.push(scope);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(`${name} must contain unique OAuth scope values`);
  }
  return Object.freeze(normalized);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function consentHtml(input: {
  clientName: string;
  clientId: string;
  resource: string;
  scopes: readonly string[];
  transactionId: string;
  csrfToken: string;
  action: string;
}): string {
  const scopes =
    input.scopes.length === 0
      ? "<li>No additional scopes requested</li>"
      : input.scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize MCP client</title></head><body><main><h1>Authorize ${escapeHtml(input.clientName)}</h1><p>Client <code>${escapeHtml(input.clientId)}</code> is requesting access to <code>${escapeHtml(input.resource)}</code>.</p><ul>${scopes}</ul><form method="post" action="${escapeHtml(input.action)}"><input type="hidden" name="transaction_id" value="${escapeHtml(input.transactionId)}"><input type="hidden" name="csrf_token" value="${escapeHtml(input.csrfToken)}"><button type="submit" name="decision" value="approve">Allow</button><button type="submit" name="decision" value="deny">Deny</button></form></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function downstreamRedirect(
  redirectUri: string,
  values: Readonly<Record<string, string>>
): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return redirect(url.toString());
}

function redirect(location: string): Response {
  return ownedResponse(null, {
    status: 302,
    headers: { Location: location },
  });
}

function routeFailure(error: unknown): Response {
  if (error instanceof RouteRegistrationError) {
    return registrationError(error.code, error.status);
  }
  if (error instanceof RouteOAuthError) {
    return oauthError(error.code, error.status);
  }
  if (error instanceof OAuthAuthorizationCoreError) {
    return oauthError(coreErrorCode(error.code), coreErrorStatus(error.code));
  }
  if (error instanceof UpstreamOAuthError) {
    return oauthError("server_error", 502);
  }
  return oauthError("server_error", 500);
}

function coreErrorCode(code: OAuthAuthorizationCoreError["code"]): string {
  switch (code) {
    case "invalid_client":
    case "invalid_request":
    case "invalid_grant":
      return code;
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    case "invalid_token":
    case "upstream_reauthorization_required":
      return "invalid_grant";
    default:
      return "server_error";
  }
}

function coreErrorStatus(code: OAuthAuthorizationCoreError["code"]): number {
  return code === "invalid_client"
    ? 401
    : code === "temporarily_unavailable"
      ? 503
      : 400;
}

function oauthError(error: string, status: number): Response {
  const body = OAuthErrorResponseSchema.parse({ error });
  return jsonResponse(body, status, true);
}

function registrationError(error: string, status: number): Response {
  const body = OAuthClientRegistrationErrorSchema.parse({ error });
  return jsonResponse(body, status, true);
}

function jsonResponse(
  value: unknown,
  status: number,
  pragma: boolean
): Response {
  return ownedResponse(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...protocolHeaders(pragma),
    },
  });
}

function protocolHeaders(pragma: boolean): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    ...(pragma ? { Pragma: "no-cache" } : {}),
  };
}

function ownedResponse(
  body: BodyInit | null,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(body, { ...init, headers });
}

function isMediaType(request: Request, expected: string): boolean {
  const header = request.headers.get("Content-Type");
  if (header === null) return false;
  return header.split(";", 1)[0]!.trim().toLowerCase() === expected;
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  );
}

function isSupportedSet(
  value: readonly string[],
  supported: readonly string[]
): boolean {
  return (
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((item) => supported.includes(item)) &&
    value.includes(supported[0]!)
  );
}

function decodeURIComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InvalidRedirectUriError();
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
}

class RouteOAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super("OAuth request could not be completed");
    this.name = "RouteOAuthError";
  }
}

class RouteRegistrationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super("OAuth client registration could not be completed");
    this.name = "RouteRegistrationError";
  }
}

class InvalidRedirectUriError extends Error {}
