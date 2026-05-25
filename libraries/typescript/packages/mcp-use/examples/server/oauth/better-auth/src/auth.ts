/**
 * Better Auth Configuration
 *
 * Sets up a Better Auth instance with:
 * - No database (sessionless/stateless mode — sessions stored in signed cookies)
 * - GitHub social login
 * - OAuth Provider plugin (for MCP OAuth flows)
 * - JWT plugin (required by OAuth Provider for token signing/verification)
 */

import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

declare const process: { env: Record<string, string | undefined> };

export const auth = betterAuth({
  // The mcp-use server is mounted at `/mcp-server`, so everything on
  // `server.app` (including Better Auth's `/api/auth/**`, the sign-in
  // page, the consent page, and `validAudiences` below) lives under
  // that prefix. Reflect it in Better Auth's own `baseURL` so its
  // self-published authorization endpoints, callbacks, and JWT issuer
  // all match the externally-visible paths.
  baseURL: "http://localhost:3000/mcp-server",
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-in-production",
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // MCP clients send the resource URL from /.well-known/oauth-protected-resource
      // as the token request's `resource` parameter. Better Auth validates it against
      // this list. The MCP transport lives at `/mcp-server/mcp` externally.
      validAudiences: ["http://localhost:3000/mcp-server/mcp"],
      // Include user profile claims in the access token JWT so
      // ctx.auth.user.email / .name / .picture are available in MCP tools.
      // Without this, Better Auth only includes standard claims (sub, iss, scope, etc.).
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
});
