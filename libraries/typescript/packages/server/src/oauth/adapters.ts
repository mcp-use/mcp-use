import {
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  type AuthInfo,
} from "@modelcontextprotocol/server";

import { getRequestBag, type FetchMiddleware } from "../fetch-app.js";
import {
  bindOAuthProvider,
  getOAuthProviderOptions,
  wrapBoundOAuthTokenVerifier,
} from "./internal.js";
import type { BoundOAuthProvider, OAuthProvider } from "./provider.js";

/**
 * Fetch middleware that requires a bearer token for a canonical resource.
 *
 * @typeParam TUser - Application user type carried by the provider.
 * @param provider - OAuth provider that verifies the bearer token.
 * @param resource - Canonical public MCP endpoint URL.
 */
export function bearerAuth<TUser>(
  provider: OAuthProvider<TUser>,
  resource: URL
): FetchMiddleware {
  return bearerAuthForBoundProvider(bindOAuthProvider(provider, resource));
}

/** @internal Creates bearer auth middleware from an existing provider binding. */
export function bearerAuthForBoundProvider<TUser>(
  boundProvider: BoundOAuthProvider<TUser>
): FetchMiddleware {
  const options = getOAuthProviderOptions(boundProvider);
  const gate = requireBearerAuth({
    verifier: wrapBoundOAuthTokenVerifier(boundProvider),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      boundProvider.resource
    ),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: [...options.requiredScopes],
    }),
  });

  return async (request, next) => {
    const result = await gate(request);
    if (result instanceof Response) {
      return result;
    }
    getRequestBag(request).authInfo = result;
    return next();
  };
}

/**
 * Fetch middleware that serves OAuth discovery metadata.
 *
 * @typeParam TUser - Application user type carried by the provider.
 * @param provider - OAuth provider that supplies authorization-server metadata.
 * @param resource - Canonical public MCP endpoint URL.
 */
export function oauthMetadata<TUser>(
  provider: OAuthProvider<TUser>,
  resource: URL
): FetchMiddleware {
  if ("bind" in provider) {
    return oauthMetadataForBoundProvider(bindOAuthProvider(provider, resource));
  }
  return createOAuthMetadataMiddleware(provider, resource);
}

/** @internal Creates discovery middleware from an existing provider binding. */
export function oauthMetadataForBoundProvider<TUser>(
  boundProvider: BoundOAuthProvider<TUser>
): FetchMiddleware {
  return createOAuthMetadataMiddleware(boundProvider, boundProvider.resource);
}

function createOAuthMetadataMiddleware<TUser>(
  provider: Pick<
    BoundOAuthProvider<TUser>,
    | "oauthMetadata"
    | "requiredScopes"
    | "scopesSupported"
    | "resourceName"
    | "serviceDocumentationUrl"
  >,
  resource: URL
): FetchMiddleware {
  const options = getOAuthProviderOptions(provider);
  return async (request, next) => {
    const response = oauthMetadataResponse(request, {
      oauthMetadata: options.oauthMetadata,
      resourceServerUrl: resource,
      ...(options.scopesSupported !== undefined && {
        scopesSupported: [...options.scopesSupported],
      }),
      ...(options.resourceName !== undefined && {
        resourceName: options.resourceName,
      }),
      ...(options.serviceDocumentationUrl !== undefined && {
        serviceDocumentationUrl: options.serviceDocumentationUrl,
      }),
    });
    if (response !== undefined) {
      return response;
    }
    return next();
  };
}
/**
 * Read verified {@link AuthInfo} from the request bag after {@link bearerAuth}.
 *
 * @param request - Request that passed through bearer auth middleware.
 */
export function authInfoFromRequest(request: Request): AuthInfo | undefined {
  return getRequestBag(request).authInfo;
}
