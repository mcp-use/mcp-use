# `mcp-use` on Cloudflare Workers

A minimal MCP server deployed as a Cloudflare Worker. The Worker exports the
framework's web-standard `server.fetch` handler directly, with no Node adapter
and no session affinity.

## What this demonstrates

- `worker.ts` exports `fetch`, calls `server.fetch(request)`, and leaves the
  Worker's bindings available through `env`.
- `smoke.ts` runs the exact exported handler under Node's `workerd` export
  condition. It performs a real JSON-RPC round trip without Wrangler, a socket,
  or network access.
- `wrangler.jsonc` deploys `worker.ts` at the Worker origin; the MCP endpoint is
  `/mcp` because the server sets `basePath: "/mcp"`.

## Run locally

```bash
pnpm smoke
```

The smoke test fails if `mcp-use` resolves to its Node entry or if the Worker
handler cannot list and call the `echo` tool.

To run the Worker in Wrangler's local runtime:

```bash
pnpm dev
```

Then point an MCP client at `http://localhost:8787/mcp`.

## Deploy

Authenticate Wrangler once, then deploy:

```bash
pnpm exec wrangler login
pnpm deploy
```

Point MCP clients at:

```text
https://<worker>.<account>.workers.dev/mcp
```

## OAuth proxy storage

Workers KV cannot provide the atomic read-and-delete required by OAuth
authorization codes. Bind a D1 database and pass it to `cloudflareStorage`.
The snippet below replaces the `MCPServer` in `worker.ts`; its `fetch` already
forwards `request`, `env`, and `ctx` to the server.

```typescript
import { env } from "cloudflare:workers";
import { MCPServer } from "mcp-use";
import { github, oauthProxy } from "mcp-use/oauth";
import { cloudflareStorage } from "mcp-use/oauth/storage";

const database = env.OAUTH_DB;
if (!database) throw new Error("Bind OAUTH_DB before enabling oauthProxy");

const storage = cloudflareStorage({
  d1: database,
  table: "mcp_use_oauth",
});

const server = new MCPServer({
  name: "workers-example",
  version: "1.0.0",
  oauth: oauthProxy({
    upstream: github({
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    }),
    secret: env.MCP_USE_OAUTH_SECRET,
    storage,
  }),
});
```

Store the OAuth credentials as Worker secrets for the deployed Worker. For
`pnpm dev`, put the same values in a git-ignored `.dev.vars` file, because
`wrangler secret put` does not populate the local runtime:

```bash
openssl rand -base64 32
pnpm exec wrangler secret put GITHUB_CLIENT_ID
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put MCP_USE_OAUTH_SECRET
```

Use the generated random value for `MCP_USE_OAUTH_SECRET`; keep it stable and
at least 32 characters long.

Add the binding to `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "OAUTH_DB",
      "database_name": "mcp-use-oauth",
      "database_id": "<database-id>"
    }
  ]
}
```

See [OAuth proxy storage](/typescript/server/authentication/providers/oauth-proxy-storage)
for D1 and Durable Object options.

## Typecheck

```bash
pnpm typecheck
```
