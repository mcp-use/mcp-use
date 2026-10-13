import { Octokit } from "@octokit/rest";
import { isBuilding, MCPServer } from "mcp-use";
import {
  github,
  memoryStorage,
  oauthProxy,
  upstreamToken,
} from "mcp-use/oauth";
import { redisStorage } from "mcp-use/oauth/storage";
import { createClient } from "redis";
import { z } from "zod";

import { ConsentPage } from "./consent/consent-page.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== "") return value;
  // `mcp-use build` runs this file without serving requests, so a build
  // needs none of these settings.
  if (isBuilding()) return "";
  throw new Error(`${name} must be set`);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

// Redis (6.2 or later) when one is configured. Otherwise memory, which
// oauthProxy accepts only while the server runs on localhost.
const redisUrl = optionalEnv("MCP_USE_REDIS_URL");
const storage =
  redisUrl === undefined
    ? memoryStorage()
    : // A function connects on the first sign-in, not when the server starts,
      // so a build or a cold start does not wait on Redis.
      redisStorage(() =>
        createClient({ url: redisUrl })
          // Without an error listener, a dropped connection crashes the
          // process. With one, node-redis logs it here and reconnects.
          .on("error", (error: unknown) => {
            console.error("Redis error:", error);
          })
          .connect()
      );

const allowedClients = optionalEnv("MCP_USE_ALLOWED_CLIENTS")
  ?.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "");

const server = new MCPServer({
  name: "oauth-proxy-github-example",
  version: "1.0.0",
  title: "GitHub OAuth proxy example",
  description:
    "Signs users in with GitHub through the server's own authorization server and calls the GitHub API as them.",
  publicLandingPage: true,
  oauth: oauthProxy({
    upstream: github({
      clientId: requireEnv("MCP_USE_GITHUB_CLIENT_ID"),
      clientSecret: requireEnv("MCP_USE_GITHUB_CLIENT_SECRET"),
      // Add "repo" to let list-repositories include private repositories.
      scopes: ["read:user"],
    }),
    // The secret comes from MCP_USE_OAUTH_SECRET.
    storage,
    // A custom consent page: src/consent/consent-page.tsx.
    consent: { page: ConsentPage },
    ...(allowedClients !== undefined && { clients: allowedClients }),
  }),
});

const whoamiOutputSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  publicRepos: z.number(),
  subject: z.string(),
  mcpClient: z.string().nullable(),
  githubScopes: z.array(z.string()),
});

server.tool(
  {
    name: "whoami",
    title: "Who am I",
    description:
      "Return the signed-in GitHub user and the MCP client that connected.",
    outputSchema: whoamiOutputSchema,
    annotations: { readOnlyHint: true },
  },
  async (_args, ctx) => {
    // upstreamToken(ctx) is the user's GitHub token, which the proxy keeps on
    // the server. The MCP client only ever holds the proxy's own token.
    const octokit = new Octokit({ auth: upstreamToken(ctx) });
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const data = {
      login: user.login,
      name: user.name,
      publicRepos: user.public_repos,
      subject: ctx.auth.user.subject,
      mcpClient: ctx.auth.clientId ?? null,
      githubScopes: ctx.auth.upstream?.scopes ?? [],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  }
);

server.tool(
  {
    name: "list-repositories",
    title: "List repositories",
    description:
      "List the signed-in user's most recently updated repositories. With the read:user scope, GitHub returns public repositories only.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(50).default(10),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ limit }, ctx) => {
    const octokit = new Octokit({ auth: upstreamToken(ctx) });
    const { data: repositories } =
      await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: limit,
      });
    const lines = repositories.map(
      (repository) =>
        `${repository.full_name}${repository.private ? " (private)" : ""}`
    );
    return {
      content: [{ type: "text", text: lines.join("\n") || "No repositories." }],
    };
  }
);

export default server;
