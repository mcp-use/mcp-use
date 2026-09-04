import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { anonymous, jwt } from "better-auth/plugins";

/** OAuth scopes supported by the local mixed-auth demo. */
export const demoScopes = [
  "openid",
  "profile",
  "email",
  "demo:protected",
] as const;

/** Options for the local Better Auth authorization server. */
export interface CreateDemoAuthOptions {
  /** Origin hosting both the authorization server and MCP resource. */
  origin: string;
  /** Canonical MCP protected-resource URL. */
  resource: string;
}

/**
 * Create the in-memory authorization server used by the demo.
 *
 * @param options - Local issuer and MCP resource URLs.
 * @returns A Better Auth instance with DCR, PKCE, anonymous login, and consent.
 */
export function createDemoAuth({ origin, resource }: CreateDemoAuthOptions) {
  return betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin, "http://localhost:4173", "http://127.0.0.1:4173"],
    secret:
      process.env["BETTER_AUTH_SECRET"] ??
      "mixed-oauth-demo-only-secret-change-before-deploying",
    plugins: [
      anonymous(),
      jwt(),
      // @ts-expect-error Better Auth 1.7.2 is incompatible with
      // exactOptionalPropertyTypes: https://github.com/better-auth/better-auth/issues/10213
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: [...demoScopes],
        clientRegistrationDefaultScopes: [...demoScopes],
        clientRegistrationAllowedScopes: [...demoScopes],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [resource],
        clientRegistrationDefaultResources: [resource],
        clientRegistrationAllowedResources: [resource],
        customAccessTokenClaims: ({ user }) => ({
          name: user?.name,
          is_anonymous: user?.isAnonymous ?? false,
        }),
      }),
    ],
  });
}
