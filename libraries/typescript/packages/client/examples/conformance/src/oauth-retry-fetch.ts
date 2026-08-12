/**
 * OAuth retry fetch wrapper for scope-step-up and scope-retry-limit conformance.
 * Intercepts 401 and 403 (insufficient_scope), runs full auth flow with escalated scope,
 * then retries the request with the new token so the auth server sees the second authorization.
 */

import {
  auth,
  computeScopeUnion,
  extractWWWAuthenticateParams,
  isStrictScopeSuperset,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";

export type OAuthRetryFetchOptions = {
  /** Max number of 403 retries (for auth/scope-retry-limit). Omit for scope-step-up. */
  max403Retries?: number;
};

type AuthProviderWithCode = OAuthClientProvider & {
  getAuthorizationCode(): Promise<string>;
  getAuthorizationResponse?: () => Promise<{
    code: string;
    iss?: string;
  }>;
};

function isInsufficientScope(response: Response): boolean {
  const { error } = extractWWWAuthenticateParams(response);
  return error === "insufficient_scope";
}

async function runAuthFlow(
  provider: AuthProviderWithCode,
  serverUrl: string | URL,
  resourceMetadataUrl: URL | undefined,
  scope: string | undefined,
  forceReauthorization = false
): Promise<void> {
  const authResult = await auth(provider, {
    serverUrl: typeof serverUrl === "string" ? serverUrl : serverUrl.toString(),
    resourceMetadataUrl,
    scope,
    forceReauthorization,
  });
  if (authResult === "REDIRECT") {
    // Keep getAuthorizationCode() for existing v0.1-style providers, while
    // using the full callback response when available so v2 can validate the
    // RFC 9207 issuer identification parameter.
    const authorizationResponse = provider.getAuthorizationResponse
      ? await provider.getAuthorizationResponse()
      : { code: await provider.getAuthorizationCode() };
    await auth(provider, {
      serverUrl:
        typeof serverUrl === "string" ? serverUrl : serverUrl.toString(),
      resourceMetadataUrl,
      scope,
      forceReauthorization,
      authorizationCode: authorizationResponse.code,
      ...(authorizationResponse.iss !== undefined
        ? { iss: authorizationResponse.iss }
        : {}),
    });
  }
}

function issuersMatch(a: string, b: string): boolean {
  return (
    a === b ||
    (a.endsWith("/") && a.slice(0, -1) === b) ||
    (b.endsWith("/") && b.slice(0, -1) === a)
  );
}

function discoveryIssuer(
  state: OAuthDiscoveryState | undefined
): string | undefined {
  return (
    state?.authorizationServerMetadata?.issuer ?? state?.authorizationServerUrl
  );
}

function isSameResourceMetadata(
  state: OAuthDiscoveryState | undefined,
  challengeUrl: URL | undefined
): boolean {
  return (
    !challengeUrl ||
    !state?.resourceMetadataUrl ||
    state.resourceMetadataUrl === challengeUrl.toString()
  );
}

/**
 * Returns the active token's granted scope only when it is provably associated
 * with the same authorization server and protected resource as the challenge.
 * A retry fetch sees issuer-less bearer reads, so this guard prevents a most
 * recently issued token for another authorization server from leaking scopes
 * into a new authorization request.
 */
async function currentIssuerScope(
  provider: AuthProviderWithCode,
  challengeUrl: URL | undefined
): Promise<{ scope?: string; tokens?: OAuthTokens }> {
  const [tokens, discoveryState] = await Promise.all([
    provider.tokens(),
    provider.discoveryState?.(),
  ]);
  const issuer = discoveryIssuer(discoveryState);

  if (
    !tokens?.scope ||
    !tokens.issuer ||
    !issuer ||
    !issuersMatch(tokens.issuer, issuer) ||
    !isSameResourceMetadata(discoveryState, challengeUrl)
  ) {
    return { tokens };
  }

  return { scope: tokens.scope, tokens };
}

/**
 * Returns a fetch that on 401 or 403 (insufficient_scope) runs the full OAuth flow
 * (auth → get code → auth with code) and retries the request with the new token.
 */
export function createOAuthRetryFetch(
  innerFetch: typeof fetch,
  serverUrl: string | URL,
  authProvider: AuthProviderWithCode,
  options: OAuthRetryFetchOptions = {}
): typeof fetch {
  const { max403Retries } = options;

  return async function oauthRetryFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    let response = await innerFetch(input, init);
    let url: string;
    let requestInit: RequestInit;

    if (typeof input === "string" || input instanceof URL) {
      url = typeof input === "string" ? input : input.toString();
      requestInit = init ?? {};
    } else {
      url = input.url;
      requestInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: input.signal,
      };
    }

    let num403Retries = 0;

    while (true) {
      const is401 = response.status === 401;
      const is403Scope =
        response.status === 403 && isInsufficientScope(response);

      if (!is401 && !is403Scope) {
        return response;
      }
      if (
        is403Scope &&
        max403Retries !== undefined &&
        num403Retries >= max403Retries
      ) {
        // Strip WWW-Authenticate header so the SDK's transport does not
        // attempt its own scope-escalation auth flow on top of ours.
        const body = await response.text();
        const strippedHeaders = new Headers();
        response.headers.forEach((v, k) => {
          if (k.toLowerCase() !== "www-authenticate")
            strippedHeaders.append(k, v);
        });
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: strippedHeaders,
        });
      }

      if (is401) {
        // A 401 can mean the resource changed its authorization server. Drop
        // only discovery before auth() so it fetches the current PRM/AS
        // metadata and resolves issuer-keyed credentials afresh. Client and
        // token entries stay available for their original issuer.
        await authProvider.invalidateCredentials?.("discovery");
      }

      await response.text();
      const { resourceMetadataUrl, scope } =
        extractWWWAuthenticateParams(response);

      const current = is403Scope
        ? await currentIssuerScope(authProvider, resourceMetadataUrl)
        : {};
      const requestedScope = computeScopeUnion(current.scope, scope);

      await runAuthFlow(
        authProvider,
        serverUrl,
        resourceMetadataUrl,
        requestedScope,
        isStrictScopeSuperset(requestedScope, current.tokens?.scope)
      );

      const tokens = await authProvider.tokens();
      const accessToken = tokens?.access_token;
      if (!accessToken) {
        return response;
      }

      const newHeaders = new Headers(requestInit.headers);
      newHeaders.set("Authorization", `Bearer ${accessToken}`);

      const newInit: RequestInit = {
        ...requestInit,
        headers: newHeaders,
        body: requestInit.body,
      };

      num403Retries += 1;
      response = await innerFetch(url, newInit);
    }
  };
}
