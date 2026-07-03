# Railway example

`@mcp-use/server` deployed as a long-lived Node process, the way Railway (or
any container/VM host without a serverless invocation model) runs an app.

## What this demonstrates

- **The CLI entry contract** (`specs/CLI_SPEC.md`): `src/index.ts` registers
  tools and `export default server` — it never calls `listen()` itself.
  `mcp-use dev` (local reload), `mcp-use build` (compile to
  `.mcp-use/build/`), and `mcp-use start` (serve the build) own the socket
  and shutdown signals. This is the node-deployment door, as opposed to the
  per-invocation `getHandler()` handler used on serverless platforms (see the
  `vercel` example).
- **A long-lived process is still stateless MCP.** `MCPServer` builds a fresh
  SDK server from its tool/resource/prompt registry on *every* request (see
  `../../specs/SPEC.md`) — the Node process living across requests is a deployment
  convenience, not a place MCP session state accumulates. Any replica behind a
  load balancer can serve any request; there is no session affinity to worry
  about. `railway.json` here sets `numReplicas: 2` specifically to make that
  point concrete — scaling out requires no sticky sessions, no shared store.
  The one thing that *does* persist across requests is ordinary Node
  module-scope state (a counter, a connection pool) local to a single
  replica's process — `server-status` reads one to make the distinction
  visible: process uptime and a request counter that survive across calls,
  while the protocol handshake underneath carries none of it.
- **Binding for public traffic.** `listen()` binds `127.0.0.1` by default,
  with Host-header validation (DNS-rebinding protection) restricted to
  localhost — requests carrying any other `Host` get `403`. Serving publicly
  is an explicit `host: "0.0.0.0"` opt-in, and that's all Railway needs: its
  edge only routes the domains assigned to the service, so foreign `Host`
  headers never reach the process (the framework logs a one-line reminder on
  unvalidated public binds). If the process is ever exposed directly, add
  `allowedHosts` naming the public hostname(s) — additive, so
  localhost-class hosts keep working.

## The tools

- `roll-dice({ sides?, count? })` — rolls dice, returns `structuredContent`
  checked against an `outputSchema` (`{ rolls, total }`).
- `server-status()` — no input; returns the process's uptime, PID, and a
  request counter, illustrating the process-vs-protocol statelessness split
  above.
- Resource `config://about` — static JSON metadata about the server.

## Run locally

```sh
pnpm dev
```

This runs `mcp-use dev` (the dev/build toolchain built into `@mcp-use/server`,
on top of `vite` as a devDependency): it imports `src/index.ts`,
serves the exported server on `127.0.0.1:3000` (no `RAILWAY_PUBLIC_DOMAIN` is
set locally), and reloads the entry on file change. Or exercise the
production path locally:

```sh
pnpm build && pnpm start
```

`mcp-use build` compiles the server to `.mcp-use/build/` (gitignored);
`mcp-use start` serves that build and logs the MCP endpoint URL.

Talk to it with any MCP client pointed at `http://localhost:3000/mcp`, or by
hand with curl (responses are SSE-framed; the JSON-RPC payload is on the
`data: ` line):

```sh
curl http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Deploy on Railway

1. Point a Railway service at this directory (or the monorepo, with this as
   the service's root). `railway.json` sets the build command (`npm run
   build`, i.e. `mcp-use build`) and start command (`npm run start`, i.e.
   `mcp-use start` serving `.mcp-use/build/`), plus the replica count and
   restart policy.
2. Railway injects `PORT` (the port your process must bind and listen on —
   `mcp-use start` reads it) and `RAILWAY_PUBLIC_DOMAIN` (the service's
   public hostname, e.g. `your-app.up.railway.app` — bare hostname, no scheme
   or port). `src/index.ts` reads the latter: when `RAILWAY_PUBLIC_DOMAIN` is
   present it sets `host: "0.0.0.0"` on the server so the container can
   receive edge traffic; otherwise it falls back to the local `127.0.0.1`
   dev config with DNS-rebinding protection on.
3. Deploy. Point your MCP client at
   `https://<your-service>.up.railway.app/mcp`.

## Typecheck

```sh
pnpm typecheck
```
