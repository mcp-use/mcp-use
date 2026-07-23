/**
 * v1 OAuth provider factories with legacy env fallbacks.
 *
 * @deprecated Import from `mcp-use/oauth/*`. Removed in mcp-use v3.
 */

import {
  oauthAuth0Provider as nativeAuth0Provider,
  type Auth0OAuthProviderOptions,
} from "../oauth/auth0.js";
import {
  oauthBetterAuthProvider as nativeBetterAuthProvider,
  type BetterAuthOAuthProviderOptions,
} from "../oauth/better-auth.js";
import {
  oauthClerkProvider as nativeClerkProvider,
  type ClerkOAuthProviderOptions,
} from "../oauth/clerk.js";
import {
  oauthKeycloakProvider as nativeKeycloakProvider,
  type KeycloakOAuthProviderOptions,
} from "../oauth/keycloak.js";
import type { OAuthProvider, OAuthResourceOptions } from "../oauth/provider.js";
import {
  oauthSupabaseProvider as nativeSupabaseProvider,
  type SupabaseOAuthProviderOptions,
} from "../oauth/supabase.js";
import {
  oauthWorkOSProvider as nativeWorkOSProvider,
  type WorkOSOAuthProviderOptions,
} from "../oauth/workos.js";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

function rejectVerifyJwt(options: unknown): void {
  if (
    typeof options === "object" &&
    options !== null &&
    (options as { verifyJwt?: unknown }).verifyJwt === false
  ) {
    throw new Error(
      "[MCP_USE_V1_COMPAT] verifyJwt: false is not supported by the temporary v1 compatibility entry; v2 always verifies bearer tokens."
    );
  }
}

function resourceOptions(
  options: OAuthResourceOptions,
  resource?: URL | string
): OAuthResourceOptions {
  return {
    ...((resource ?? options.resource) !== undefined && {
      resource: resource ?? options.resource,
    }),
    ...(options.requiredScopes !== undefined && {
      requiredScopes: options.requiredScopes,
    }),
    ...(options.scopesSupported !== undefined && {
      scopesSupported: options.scopesSupported,
    }),
    ...(options.resourceName !== undefined && {
      resourceName: options.resourceName,
    }),
    ...(options.serviceDocumentationUrl !== undefined && {
      serviceDocumentationUrl: options.serviceDocumentationUrl,
    }),
  };
}

/** @deprecated Removed in mcp-use v3. */
export function oauthSupabaseProvider(
  options: Partial<SupabaseOAuthProviderOptions> = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const projectId =
    options.projectId ?? env("MCP_USE_OAUTH_SUPABASE_PROJECT_ID");
  const supabaseUrl = options.supabaseUrl ?? env("MCP_USE_OAUTH_SUPABASE_URL");
  const jwtSecret =
    options.jwtSecret ?? env("MCP_USE_OAUTH_SUPABASE_JWT_SECRET");
  return nativeSupabaseProvider({
    ...resourceOptions(options),
    ...(projectId !== undefined && { projectId }),
    ...(supabaseUrl !== undefined && { supabaseUrl }),
    ...(jwtSecret !== undefined && { jwtSecret }),
  });
}

/** @deprecated Removed in mcp-use v3. */
export function oauthAuth0Provider(
  options: Partial<Auth0OAuthProviderOptions> & {
    audience?: string;
    verifyJwt?: boolean;
  } = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const domain = options.domain ?? env("MCP_USE_OAUTH_AUTH0_DOMAIN");
  const audience = options.audience ?? env("MCP_USE_OAUTH_AUTH0_AUDIENCE");
  if (domain === undefined) throw new Error("Auth0 domain is required.");
  return nativeAuth0Provider({
    ...resourceOptions(options, options.resource ?? audience),
    domain,
  });
}

/** @deprecated Removed in mcp-use v3. */
export function oauthKeycloakProvider(
  options: Partial<KeycloakOAuthProviderOptions> & {
    audience?: string;
    verifyJwt?: boolean;
  } = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const serverUrl =
    options.serverUrl ?? env("MCP_USE_OAUTH_KEYCLOAK_SERVER_URL");
  const realm = options.realm ?? env("MCP_USE_OAUTH_KEYCLOAK_REALM");
  const audience = options.audience ?? env("MCP_USE_OAUTH_KEYCLOAK_AUDIENCE");
  if (serverUrl === undefined || realm === undefined) {
    throw new Error("Keycloak serverUrl and realm are required.");
  }
  return nativeKeycloakProvider({
    ...resourceOptions(options, options.resource ?? audience),
    serverUrl,
    realm,
  });
}

/** @deprecated Removed in mcp-use v3. */
export function oauthWorkOSProvider(
  options: Partial<WorkOSOAuthProviderOptions> & { verifyJwt?: boolean } = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const subdomain = options.subdomain ?? env("MCP_USE_OAUTH_WORKOS_SUBDOMAIN");
  if (subdomain === undefined) throw new Error("WorkOS subdomain is required.");
  return nativeWorkOSProvider({
    ...resourceOptions(options),
    subdomain,
  });
}

/** @deprecated Removed in mcp-use v3. */
export function oauthClerkProvider(
  options: Partial<ClerkOAuthProviderOptions> & {
    audience?: string;
    verifyJwt?: boolean;
  } = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const frontendApiUrl =
    options.frontendApiUrl ?? env("MCP_USE_OAUTH_CLERK_FRONTEND_API_URL");
  if (frontendApiUrl === undefined) {
    throw new Error("Clerk frontendApiUrl is required.");
  }
  return nativeClerkProvider({
    ...resourceOptions(options, options.resource ?? options.audience),
    frontendApiUrl,
  });
}

/** @deprecated Removed in mcp-use v3. */
export function oauthBetterAuthProvider(
  options: Partial<BetterAuthOAuthProviderOptions> & {
    verifyJwt?: boolean;
  } = {}
): OAuthProvider<unknown> {
  rejectVerifyJwt(options);
  const authURL = options.authURL ?? env("MCP_USE_OAUTH_BETTER_AUTH_URL");
  if (authURL === undefined)
    throw new Error("Better Auth authURL is required.");
  return nativeBetterAuthProvider({
    ...resourceOptions(options),
    authURL,
  });
}
