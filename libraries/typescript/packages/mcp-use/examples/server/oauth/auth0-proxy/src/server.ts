/**
 * Auth0 OAuth Proxy MCP Server Example
 *
 * Demonstrates the OAuth proxy mode using a pre-registered Auth0 Regular Web App.
 * Unlike the DCR-direct auth0/ example, this works without Auth0's Early Access DCR feature.
 *
 * The MCP server mediates the entire OAuth flow:
 *   /register → returns pre-registered client_id
 *   /authorize → redirects to Auth0 with injected params
 *   /token → forwards to Auth0 with injected client credentials
 *
 * Environment variables:
 *   AUTH0_DOMAIN         (required) e.g. my-tenant.us.auth0.com
 *   AUTH0_CLIENT_ID      (required) Regular Web App client ID
 *   AUTH0_CLIENT_SECRET  (recommended) client secret
 *   AUTH0_AUDIENCE       (required for JWT tokens) API identifier
 */

import {
  MCPServer,
  oauthProxy,
  jwksVerifier,
  object,
  error,
} from "mcp-use/server";

const domain = process.env.AUTH0_DOMAIN;
const clientId = process.env.AUTH0_CLIENT_ID;
const clientSecret = process.env.AUTH0_CLIENT_SECRET;
const audience = process.env.AUTH0_AUDIENCE ?? "";

if (!domain || !clientId) {
  console.error("Missing required env vars: AUTH0_DOMAIN, AUTH0_CLIENT_ID");
  process.exit(1);
}

const server = new MCPServer({
  name: "auth0-proxy-example",
  version: "1.0.0",
  description: "MCP server with Auth0 OAuth proxy authentication",
  oauth: oauthProxy({
    authEndpoint: `https://${domain}/authorize`,
    tokenEndpoint: `https://${domain}/oauth/token`,
    issuer: `https://${domain}/`,
    clientId,
    clientSecret,
    scopes: ["openid", "email", "profile"],
    extraAuthorizeParams: { audience },
    verifyToken: jwksVerifier({
      jwksUrl: `https://${domain}/.well-known/jwks.json`,
      issuer: `https://${domain}/`,
      audience,
    }),
  }),
});

server.tool(
  {
    name: "get-user-info",
    description: "Get information about the authenticated user from the JWT",
  },
  async (_args, ctx) =>
    object({
      userId: ctx.auth.user.userId,
      email: ctx.auth.user.email,
      name: ctx.auth.user.name,
      picture: ctx.auth.user.picture,
      scopes: ctx.auth.scopes,
    })
);

server.tool(
  {
    name: "get-auth0-user-profile",
    description: "Fetch the full user profile from Auth0's /userinfo endpoint",
  },
  async (_args, ctx) => {
    try {
      const res = await fetch(`https://${domain}/userinfo`, {
        headers: { Authorization: `Bearer ${ctx.auth.accessToken}` },
      });
      if (!res.ok) {
        return error(`Auth0 /userinfo returned ${res.status}`);
      }
      return object(await res.json());
    } catch (err) {
      return error(`Failed to fetch user profile: ${err}`);
    }
  }
);

server.listen().then(() => {
  console.log("Auth0 Proxy OAuth MCP Server Running");
});
