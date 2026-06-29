/**
 * Better Auth configuration for the sign-in aware tools example.
 *
 * No database is configured, so Better Auth uses its in-memory adapter for this
 * local demo. Restarting the server clears users, sessions, clients, consents,
 * and issued OAuth tokens.
 */

import { betterAuth } from "better-auth";
import { anonymous, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

declare const process: { env: Record<string, string | undefined> };

export type ExampleAuth = {
  handler: (request: Request) => Response | Promise<Response>;
  api: {
    getOAuthServerConfig: (...args: unknown[]) => unknown;
    getOpenIdConfig: (...args: unknown[]) => unknown;
  };
};

export const auth = betterAuth({
  baseURL: "http://localhost:3000",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-in-production",
  plugins: [
    anonymous({
      emailDomainName: "example.invalid",
      generateName: () => "Guest user",
    }),
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      validAudiences: ["http://localhost:3000/mcp"],
      customAccessTokenClaims: async ({ user }) => ({
        email: user?.email,
        name: user?.name,
        picture: user?.image,
      }),
      silenceWarnings: {
        oauthAuthServerConfig: true,
      },
    }),
  ],
}) as unknown as ExampleAuth;
