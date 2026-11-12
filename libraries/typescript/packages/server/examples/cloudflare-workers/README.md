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
authorization codes. Bind a D1 database and pass it to `cloudflareStorage`:

```typescript
import { cloudflareStorage } from "mcp-use/oauth/storage";

const storage = cloudflareStorage({
  d1: env.OAUTH_DB,
  table: "mcp_use_oauth",
});
```

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
