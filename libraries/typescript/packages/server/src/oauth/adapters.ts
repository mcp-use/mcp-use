import {
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import type { Env, MiddlewareHandler } from "hono";

import { getOAuthProviderOptions, wrapOAuthTokenVerifier } from "./internal.js";
import type { OAuthProvider } from "./provider.js";

/** Hono variables populated after OAuth bearer authentication succeeds. */
interface OAuthHonoEnv extends Env {
  Variables: {
    /** Verified SDK authentication information. */
    authInfo: AuthInfo;
  };
}

/**
 * Creates Hono middleware that requires a bearer token for a canonical resource.
 *
 * @typeParam TUser - Application user type carried by the provider.
 * @param provider - OAuth provider that verifies the bearer token.
 * @param resource - Canonical public MCP endpoint URL.
 * @returns Middleware that stores verified {@link AuthInfo} in `authInfo`.
 */
export function bearerAuth<TUser>(
  provider: OAuthProvider<TUser>,
  resource: URL
): MiddlewareHandler<OAuthHonoEnv> {
  const options = getOAuthProviderOptions(provider);
  const gate = requireBearerAuth({
    verifier: wrapOAuthTokenVerifier(provider, resource),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: [...options.requiredScopes],
    }),
  });

  return async (context, next) => {
    const result = await gate(context.req.raw);
    if (result instanceof Response) {
      return result;
    }
    context.set("authInfo", result);
    await next();
  };
}

/**
 * Creates Hono middleware that serves OAuth discovery metadata.
 *
 * @typeParam TUser - Application user type carried by the provider.
 * @param provider - OAuth provider that supplies authorization-server metadata.
 * @param resource - Canonical public MCP endpoint URL.
 * @returns Middleware that serves matching discovery routes or falls through.
 */
export function oauthMetadata<TUser>(
  provider: OAuthProvider<TUser>,
  resource: URL
): MiddlewareHandler {
  const options = getOAuthProviderOptions(provider);
  return async (context, next) => {
    const response = oauthMetadataResponse(context.req.raw, {
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
    await next();
  };
}
