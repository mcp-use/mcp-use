# `mcp-use` on Vercel

A minimal MCP server deployed as a Vercel serverless Function, demonstrating
the framework's stateless design end to end.

## What this demonstrates

- **`server.getHandler()` is the serverless deployment door.** `MCPServer`
  builds a fresh SDK server per HTTP request (no session affinity, no shared
  in-memory state), so its web-standard `(request: Request) => Promise<Response>`
  handler works unmodified as a Vercel Function — no adapter layer, no shim.
  See `api/mcp.ts`.
- **Two tools with zod schemas** (`mcp-server.ts`): `convert-temperature` has
  an `outputSchema`, so its result carries compile-time- and runtime-checked
  `structuredContent`; `roll-dice` returns plain text content, no
  `outputSchema`.
- **One resource**, `vercel://deployment`, that reports the env/region/URL of
  the function instance actually serving the request — a live look at the
  serverless environment.
- **Zero Host/Origin configuration.** DNS-rebinding protection exists to
  guard locally bound servers; `getHandler()` never binds a socket, so it
  applies no Host validation by default. That's safe on Vercel because the
  platform edge only routes hostnames assigned to the deployment — a
  DNS-rebinding-style `Host` never reaches the function. To opt into strict
  validation anyway, set `allowedHosts` (additive: localhost-class hosts
  stay allowed, so local runs keep working).

## Why serverless works here

Vercel Functions are invoked per-request (and reused while "warm," with no
guaranteed continuity between invocations). A server that kept per-client
session state in memory would behave inconsistently across cold starts and
horizontal scaling. `MCPServer` never does that — `getHandler()` mounts the
Hono app and MCP registry once (cheap, at module scope), and every incoming
request gets a brand-new SDK server built from that registry. There is
nothing to lose between invocations, which is exactly what serverless
requires.

## Project layout

```
mcp-server.ts    module-scope MCPServer: tool and resource registrations
api/mcp.ts       Vercel Function entry — exports server.getHandler() as `fetch`
smoke.ts         local, no-network test of the exported handler
```

### The basePath / function-path trap

Vercel serves any file under `api/` at the matching `/api/<name>` path with
zero config. `api/mcp.ts` is therefore served at `/api/mcp` — so
`mcp-server.ts` sets `basePath: "/api/mcp"` on the `MCPServer` (overriding the
framework's `/mcp` default) to match. If these two ever drift — say, the file
is renamed but `basePath` isn't updated — requests 404 with no indication why,
since Hono simply has no route matching the path Vercel forwards. There's no
`vercel.json` in this example; keeping the function's file path and the
server's `basePath` in sync is the entire routing story.

## Run locally

Smoke test (no server, no network — invokes the exported handler directly):

```bash
node smoke.ts
```

Or serve it with the Vercel CLI's local dev server (requires `vercel login`
once):

```bash
npx vercel dev
```

Then point an MCP client at `http://localhost:3000/api/mcp`.

## Deploy

```bash
npx vercel deploy
```

No environment configuration is needed. Once deployed, point an MCP client
at:

```
https://<your-deployment>.vercel.app/api/mcp
```

## Typecheck

```bash
pnpm typecheck
```
