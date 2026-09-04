import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { anonymous, jwt } from "better-auth/plugins";

export interface CreateAuthOptions {
  origin: string;
  resource: string;
}

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
      // @ts-expect-error Better Auth 1.7.2 is incompatible with
      // exactOptionalPropertyTypes: https://github.com/better-auth/better-auth/issues/10213
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        resources: [resource],
        clientRegistrationDefaultResources: [resource],
        clientRegistrationAllowedResources: [resource],
        customAccessTokenClaims: ({ user }) => ({
          email: user?.email,
          name: user?.name,
          is_anonymous: user?.isAnonymous ?? false,
        }),
      }),
    ],
  });
}
