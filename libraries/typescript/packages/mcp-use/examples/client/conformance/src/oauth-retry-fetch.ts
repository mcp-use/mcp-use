/**
 * OAuth retry fetch wrapper for scope-step-up and scope-retry-limit conformance.
 * Intercepts 401 and 403 (insufficient_scope), runs full auth flow with escalated scope,
 * then retries the request with the new token so the auth server sees the second authorization.
 */

import {
  auth,
  extractWWWAuthenticateParams,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

export type OAuthRetryFetchOptions = {
  /** Max number of 403 retries (for auth/scope-retry-limit). Omit for scope-step-up. */
  max403Retries?: number;
};

type AuthProviderWithCode = OAuthClientProvider & {
  getAuthorizationCode(): Promise<string>;
};

function isInsufficientScope(response: Response): boolean {
  const { error } = extractWWWAuthenticateParams(response);
  return error === "insufficient_scope";
}

async function runAuthFlow(
  provider: AuthProviderWithCode,
  serverUrl: string | URL,
  resourceMetadataUrl: URL | undefined,
  scope: string | undefined
): Promise<void> {
  const authResult = await auth(provider, {
    serverUrl: typeof serverUrl === "string" ? serverUrl : serverUrl.toString(),
    resourceMetadataUrl,
    scope,
  });
  if (authResult === "REDIRECT") {
    const authCode = await provider.getAuthorizationCode();
    await auth(provider, {
      serverUrl:
        typeof serverUrl === "string" ? serverUrl : serverUrl.toString(),
      resourceMetadataUrl,
      scope,
      authorizationCode: authCode,
    });
  }
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

      await response.text();
      const { resourceMetadataUrl, scope } =
        extractWWWAuthenticateParams(response);

      await runAuthFlow(authProvider, serverUrl, resourceMetadataUrl, scope);

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
