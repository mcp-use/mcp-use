import { MCPServer } from "mcp-use";
import { oauthProxy, type OAuthProxyJsonObject } from "mcp-use/oauth";
import { z } from "zod";

const githubUserSchema = z.object({
  id: z.number().int().nonnegative(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.url(),
  html_url: z.url(),
});

const githubUserOutputSchema = z.object({
  id: z.string(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatarUrl: z.url(),
  profileUrl: z.url(),
});

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set`);
  }
  return value;
}

async function fetchGitHubUser(providerAccessToken: string) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${providerAccessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub user verification failed (${response.status})`);
  }
  return githubUserSchema.parse(await response.json());
}

const server = new MCPServer({
  name: "github-oauth-proxy-example",
  version: "1.0.0",
  title: "GitHub OAuth Proxy example",
  description:
    "Brokers a fixed GitHub OAuth App for dynamically registered MCP clients.",
  publicLandingPage: true,
  oauth: oauthProxy({
    authEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    clientId: requireEnv("GITHUB_CLIENT_ID"),
    clientSecret: requireEnv("GITHUB_CLIENT_SECRET"),
    tokenEndpointAuthMethod: "client_secret_post",
    scopes: ["read:user"],
    async verifyToken(providerAccessToken) {
      const user = await fetchGitHubUser(providerAccessToken);
      const payload: OAuthProxyJsonObject = {
        sub: String(user.id),
        preferred_username: user.login,
        name: user.name,
        email: user.email,
        picture: user.avatar_url,
        profile_url: user.html_url,
      };
      return { payload };
    },
  }),
});

server.tool(
  {
    name: "get-github-user",
    title: "Get GitHub user",
    description:
      "Call GitHub with the authenticated user's provider access token.",
    outputSchema: githubUserOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    const providerAccessToken = ctx.auth.providerAccessToken;
    if (providerAccessToken === undefined) {
      throw new Error("GitHub provider access token is unavailable");
    }
    const user = await fetchGitHubUser(providerAccessToken);
    const data = {
      id: String(user.id),
      login: user.login,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

export default server;
