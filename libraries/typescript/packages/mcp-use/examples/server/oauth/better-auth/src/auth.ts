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
  // The MCP server lives at `/mcp-server` (see server.ts) and we want Better
  // Auth nested under it at `/mcp-server/api/auth` — both so it doesn't
  // shadow MCP's own routes under the basePath, and so every endpoint
  // (issuer, /oauth2/*, /sign-in/*, /jwks, …) anchors on a sub-path that
  // never collides with the MCP transport. `baseURL` stays as the origin
  // and `basePath` carries the full path; that's the same split Better Auth
  // uses elsewhere, just with the MCP basePath segment prepended.
  baseURL: "http://localhost:3000",
  basePath: "/mcp-server/api/auth",
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
      loginPage: "/mcp-server/sign-in",
      consentPage: "/mcp-server/consent",
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
