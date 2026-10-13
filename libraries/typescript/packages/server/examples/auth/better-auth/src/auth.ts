import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { anonymous, jwt } from "better-auth/plugins";

/** URLs used by the local Better Auth authorization server. */
export interface CreateAuthOptions {
  /** Public origin hosting the authorization server. */
  origin: string;
  /** Canonical MCP resource URL to bind to registered clients and tokens. */
  resource: string;
}

/**
 * Create an in-memory authorization server with resource-bound OAuth tokens.
 *
 * @param options - Local issuer and MCP resource URLs.
 * @returns A Better Auth instance with registration, sign-in, and consent.
 */
export function createAuth({ origin, resource }: CreateAuthOptions) {
  return betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [new URL(resource).origin],
    secret:
      process.env["BETTER_AUTH_SECRET"] ??
      "development-only-secret-change-before-deploying",

    // With no database, Better Auth stores sessions in signed cookies and
    // uses its in-memory adapter for this demo's users and OAuth records.
    plugins: [
      anonymous(),
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [resource],
        clientRegistrationDefaultResources: [resource],
        customAccessTokenClaims: ({ user }) => ({
          email: user?.email,
          name: user?.name,
          is_anonymous: user?.isAnonymous ?? false,
        }),
        silenceWarnings: { oauthAuthServerConfig: true },
      }),
    ],
  });
}
