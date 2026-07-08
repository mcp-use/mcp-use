# @mcp-use/server — build/dev/start CLI spec

**Status:** Implemented (`build`/`dev`/`start` + inspector CDN shell; `examples/railway` follows the entry contract, verified end-to-end). Companion to `SPEC.md`; this document is the v2 build/dev/start contract (Linear MCP-2601). It is a contract, not an options memo.
**Scope:** `mcp-use build`, `mcp-use dev`, `mcp-use start`, and Inspector mounting via CDN.
**Packages:** a single package, `@mcp-use/server` — the bin, `start`, the inspector shell, *and* the `dev`/`build` toolchain (`src/cli/`), which the bin reaches only through a dynamic import (§ Package layout, below). There is deliberately no separate toolchain package — see "Why one package, not two" below. The old `packages/cli` stays untouched and green until cutover; nothing in it is ported wholesale.
**v1 reference:** `packages/cli` defines *what* the commands must do for users, never how. The v1 dependency cycle (`mcp-use` `bin.ts` statically imported `@mcp-use/cli`, the CLI imported `mcp-use/config`, and all three packages — including inspector — declared each other as runtime workspace deps) is the anti-pattern this spec exists to make structurally impossible.

## Goals

- Installing `mcp-use` (plus `vite` as a devDependency) makes `"dev": "mcp-use dev"`, `"build": "mcp-use build"`, `"start": "mcp-use start"` work in a user's `package.json` scripts.
- Production `mcp-use start` requires **zero** build-toolchain code — no vite, no cli chunk, nothing beyond `@mcp-use/server`'s own runtime deps.
- Command implementations are lazy-loaded per subcommand; `start` never pays for `dev`/`build` machinery.
- The inspector UI ships to users via CDN, not as a package dependency of anything.

## Non-goals (this contract)

- React/views and the client-side Vite environment (view bundling) — **`VIEWS_SPEC.md`** owns that contract. It extends this one: the views client environment joins the *same* Vite dev server `dev` already runs, and view-file edits get real Vite HMR there. The server-entry contract below is untouched by it.
- HMR **of the server entry** — permanently. Server-entry reload is **reload, not HMR** (see "Why the server entry reloads instead of HMR" below).
- Emitting `list_changed` notifications on dev reload — **deferred**, not rejected: under the stateless wire the next `tools/list` is always current, so the notification is a nicety for long-lived clients (the inspector). It lands with the notifications phase (`SPEC.md`), not with this contract.
- Typegen — never part of `dev`/`build`/`start`. If built at all, it is an explicit escape-hatch command (`VIEWS_SPEC.md` § Typegen, demoted), off the hot path by design.
- Deploy/cloud commands, project scaffolding. (Dev tunneling is in scope — see the dev-only inspector API routes below.)
- Auth (`AUTH_SPEC.md` owns that design — currently deferred until the official SDK ships auth support; these commands neither add nor bypass it).

## Entry contract

The user's server entry module **default-exports the `MCPServer` instance and never calls `listen()` itself**:

```ts
// src/index.ts
import { MCPServer } from "mcp-use";
const server = new MCPServer({ name: "acme-tools", version: "1.0.0" });
server.tool(/* … */);
export default server;
```

`mcp-use dev` and `mcp-use start` own the socket. Serverless targets (Vercel, etc.) bypass the CLI entirely and wrap `server.getHandler()` in their own handler file — `examples/vercel` already matches this shape (module-scope server + `api/mcp.ts` wrapping `getHandler()`). `mcp-use build` is the blessed path for node deployments, but `package.json` scripts are user-owned; nothing enforces it.

**Entry discovery:** conventional locations, first hit wins — `src/index.ts`, `src/server.ts`, `index.ts`, `server.ts` — overridable with `--entry <path>` on `dev` and `build`.

`examples/railway` follows this shape (its platform door is `mcp-use build` + `mcp-use start`; host selection via `RAILWAY_PUBLIC_DOMAIN` stays constructor config on the server, which `dev`/`start` honor through `listen()`).

## Package layout & dependency rules

`@mcp-use/server` ships the bin:

```jsonc
// packages/server/package.json
{ "bin": { "mcp-use": "./dist/bin.js" } }
```

The bin is thin: `src/bin.ts` calls `main()` in `src/bin/main.ts`, which parses args (`src/bin/args.ts`), runs `start` via a **static** import of `src/bin/start.ts` (zero toolchain deps on that path), and dispatches `dev` and `build` via **`await import("../cli/index.js")`** — a dynamic import of a sibling chunk *inside this same package*, built from `src/cli/*` as its own tsup entry (`dist/cli/index.js`, alongside `dist/index.js` and `dist/bin.js`; code-splitting is on specifically so this is a real separate file with a real dynamic import, not inlined into `dist/bin.js`). Nothing on the `start`/library import path (`dist/index.js`, and everything `dist/bin.js` reaches *without* going through that dynamic import) ever evaluates `src/cli/*` — and therefore never evaluates `vite`, which only `src/cli/build.ts` and `src/cli/dev.ts` import.

`vite` is declared as an **optional peer dependency**:

```jsonc
// packages/server/package.json
{
  "peerDependencies": { "vite": "^8.0.0" },
  "peerDependenciesMeta": { "vite": { "optional": true } }
}
```

Rationale: npm 7+ auto-installs a package's *required* peer dependencies, which would drag vite into every production `npm i mcp-use` — exactly what the CLI-cycle rework is trying to avoid. Marking it `optional: true` in `peerDependenciesMeta` opts out of that auto-install, so a production install without `vite` in the user's own `devDependencies` stays lean; declaring it as a peer at all (rather than omitting it entirely) also gets the *version* resolved correctly under pnpm's isolated `node_modules` layout when it is present, instead of each consumer potentially resolving a different transitive copy. `vite` is never a regular dependency of `@mcp-use/server` — regular dependencies are always installed, defeating the point.

When `vite` is missing, `src/cli/build.ts`/`src/cli/dev.ts`'s own `import { build } from "vite"` fails to resolve, and that rejection propagates up through the bin's `import("../cli/index.js")` call. The bin classifies it (`ERR_MODULE_NOT_FOUND` naming `'vite'`, via `isViteMissing` in `bin/main.ts`) and prints an actionable hint instead of a raw stack trace:

```
mcp-use dev requires Vite. Install it:
  npm i -D vite
```

**Hard rule:** `@mcp-use/server` declares **no dependency of any kind** — regular, peer, or optional — on `@mcp-use/inspector`. The inspector is reached only over HTTP (below), never imported. There is a separate, narrower invariant for the toolchain now that it lives inside this package: `vite` must never become a regular dependency, and the `src/cli/*` chunk must never be reachable from the `start` command or from this package's `"."` library export — only from the bin's `dev`/`build` dispatch.

**Why one package, not two.** A separate toolchain package (a `@mcp-use/devkit`) would have to be reached via a `node_modules`-walking dynamic import resolved from the *user's* project, because a bare `import("@mcp-use/devkit")` inside `@mcp-use/server` can never succeed under pnpm's isolated installs — the runtime package only sees its own declared deps. Ecosystem precedent goes the other way: Astro/`skybridge`-style tools ship one core package with `vite` as a peer and `await import("vite")` internally; SvelteKit does the same (`vite` as a peer of `@sveltejs/kit`, not a separate kit-plus-vite-adapter split); Next.js ships one package and lazily imports each subcommand's machinery. One package gets the same "start pays nothing for the toolchain" property via a same-package dynamic import (verified structurally by the build output, not by hoping a separate package's resolution walk succeeds) while avoiding an entire extra package, its own dependency-direction rule, and its own release/version-matching surface. Ours differs from that precedent only in making the peer *optional* rather than required, for the auto-install reason above.

Target user `package.json` shape:

```jsonc
{
  "scripts": {
    "dev": "mcp-use dev",
    "build": "mcp-use build",
    "start": "mcp-use start"
  },
  "dependencies": { "mcp-use": "^2" },
  "devDependencies": { "vite": "^8" }
}
```

**Self-referencing devDependency (in-repo testing only).** `packages/server/package.json` lists `"@mcp-use/server": "workspace:*"` in its own `devDependencies`. The CLI tests run the real `build`/`dev` pipeline against `tests/cli/fixtures/basic`, whose entry imports `@mcp-use/server` by its public name — the fixture stands in for a real user project, so it must exercise the same resolution path users hit. Node's own resolver would handle that via package self-reference (a package may import its own name through its `exports` map), but Vite/Rolldown's resolver and tsc's bundler mode don't implement self-reference, so inside this repo the name must physically exist in `node_modules` for the toolchain to resolve it. The self-dep makes pnpm create exactly that link (`node_modules/@mcp-use/server → ..`; pnpm accepts self-deps without complaint). It is invisible to consumers — installers ignore a dependency's `devDependencies` — and creates no build-graph cycle. Do not "fix" it by switching the fixture to a relative import (stops testing the user-facing path) or by adding a Vite `resolve.alias` in the test harness (bypasses the exact resolver behavior under test).

## Workspace layout (`.mcp-use/`)

The build system keeps v1's reworked workspace convention **exactly** — it was deliberately redesigned just before this greenfield rewrite (see `packages/mcp-use/src/server/config/paths.ts`, `resolveWorkspacePaths`); do not invent a new layout. `.mcp-use/` is the per-project, fixed-convention, gitignored workspace — the `.next` analog. Everything tooling writes for a project lives under it, a checkout stays clean, and `rm -rf .mcp-use` is always safe:

```
.mcp-use/
├─ build/        ← compiled server + manifest.json (this spec); views add build/views/ (assets + public/, VIEWS_SPEC.md)
├─ generated/    ← output of the typegen escape-hatch command — reserved (VIEWS_SPEC.md § Typegen, demoted)
├─ cache/        ← disposable dev/build scratch (vite cacheDir)
├─ state/        ← mutable runtime state (e.g. tunnel.json)
└─ cloud/        ← cloud linkage (link.json) — reserved; future
```

This contract writes `build/` (using `cache/` as Vite's `cacheDir`, and `state/tunnel.json` during dev when tunneling); `generated/` and `cloud/` are **reserved by convention now** so no tool squats on them before their features land. v1's invariant carries over: `build/` contains no mutable runtime state (that is `state/`'s job), so build output stays reproducible and disposable. Because everything under `.mcp-use/` is gitignored and `rm -rf`-safe, nothing committed ever lives here — scaffolded, committed files (e.g. the `src/register.d.ts` typing shim, `VIEWS_SPEC.md` § Typing) belong in the project source tree instead.

Rules, all inherited from v1 and locked:

- **No config file.** There is deliberately no `mcp-use.json` and no `outDir` knob: runtime/project configuration lives on the `MCPServer` constructor (tooling reads it by importing the entry and introspecting the instance); the `.mcp-use/` layout is fixed convention, not configuration.
- **Same names, re-declared.** The manifest basename is `manifest.json` (v1's `BUILD_MANIFEST_NAME`), the workspace dir `.mcp-use` (v1's `WORKSPACE_DIR_NAME`). `src/cli/workspace.ts` **re-declares** these constants itself — it must not import them from the old `mcp-use` package (no dependency on the old package).
- **Per-project, not global.** `.mcp-use/` is distinct from the **global** `~/.mcp-use/` directory (CLI auth, credentials, per-user caches); nothing in this spec touches the global store.

## Commands

### `mcp-use build` (in `src/cli/build.ts`, dispatched from the bin)

Vite build of the **SSR/node environment only** — no client environment exists yet (`VIEWS_SPEC.md` adds it for views). Rolldown/Vite emits the server bundle to `.mcp-use/build/` (workspace layout above) with `ssr: { external: true }`: every bare import stays external and resolves from `node_modules` at runtime; only the user's own source is bundled. Output is ESM targeting the package's Node floor, with sourcemaps, unminified.

Writes `.mcp-use/build/manifest.json` (v1's `BUILD_MANIFEST_NAME`, shape compatible in spirit with the v1 manifest):

```jsonc
{ "buildId": "…", "entryPoint": "index.js", "createdAt": "…", "inspector": true }
```

`buildId` is a random hex id, `createdAt` an ISO timestamp — introspection data for tooling. `start` consumes only `entryPoint` today. Known gap, recorded honestly: `inspector` is currently written as a hardcoded `true` rather than introspected from the built server's config, and nothing consumes it yet (the built server's own `MCPServer` config governs the inspector route at runtime). Views extend this manifest with a `views` map (`VIEWS_SPEC.md` § Manifest) and copy the project-root `public/` directory into `build/views/public/` when present.

**No typecheck step in v0** — deliberate. Users run `tsc --noEmit` via their own script; the build is transpile-only and fast.

### `mcp-use dev` (in `src/cli/dev.ts`, dispatched from the bin)

A single long-lived process. It:

1. Creates a Vite dev server (Environment API, node/SSR environment only) and loads the entry through the module runner.
2. Grabs the default-exported `MCPServer`, wraps `server.getHandler()` behind an **atomically swappable reference**.
3. Binds **one** `@hono/node-server` listener that delegates every request to the current handler.

On file change (only files in the entry's module graph count): Vite invalidates, dev re-imports the entry through the runner, and swaps the handler reference. No registration diffing, no MCP notifications (`list_changed` emission is deferred — see "Why the server entry reloads instead of HMR") — the next request simply hits the new handler, which is correct by construction under the stateless model.

- **Port:** `--port`, else `PORT` env, else `3000`; if taken, probe upward.
- **Host:** `127.0.0.1` by default; `--host` to override (matching the server's own localhost-first posture, SPEC.md delta 5). Printed and auto-opened URLs use the browsable equivalent: `localhost` for loopback/wildcard binds, the given host verbatim otherwise; wildcard binds additionally print a `Network:` line with the machine's LAN address.
- **DNS-rebinding protection:** `getHandler()` deliberately applies no Host/Origin validation (its contract assumes a platform edge in front) — in dev, this process is the edge. On localhost-class binds the listener validates against the localhost allowlists plus the active tunnel hostname (tunnel traffic arrives with the tunnel's public Host), rejecting with the SDK's JSON-RPC 403 shape *before* any routing, so the MCP endpoint, the dev API routes, and Vite-served module URLs are all covered. `Host` is checked on every request (rebinding manifests as a non-localhost Host); `Origin` only on non-GET/HEAD — sandboxed view iframes have an opaque origin, so their module/asset GETs legitimately carry `Origin: null`. Those loads also run in CORS mode, so they need permissive `Access-Control-Allow-Origin`: the MCP server's view asset and public routes (mounted in both dev and production) always emit `*`, while Vite-served module URLs emit `*` **only while the tunnel is active** (checked per request, so runtime tunnel start/stop takes effect immediately). An unexposed dev server's module graph — source, not built assets — thus stays unreadable cross-origin; the cost is that a host page connecting to `localhost` directly (not through the tunnel) cannot load dev view modules. Vite's own CORS middleware is disabled (`cors: false`) so its localhost-only default neither blocks tunnel-rendering hosts nor fights the gated header. Non-localhost binds get no validation (the legitimate hostnames are unknowable) and print a warning instead.
- **Tunnel:** `--tunnel` starts a public tunnel as soon as the HTTP listener is bound (via `npx @mcp-use/tunnel`). The inspector UI can also start/stop the tunnel at runtime through dev-only API routes (below) without restarting the dev process.
- **Auto-open:** once the listener is bound, the inspector URL is opened in the default browser (dependency-free `open`/`start`/`xdg-open` spawn, best-effort). `--no-open` disables it, and it is skipped automatically when stdout is not a TTY, so agents/CI never trigger a browser launch or see a "failed to open" error.
- **Env:** `.env` loaded via Node's native `process.loadEnvFile()` (guarded by an `existsSync` check, since `loadEnvFile` throws on a missing file) before the entry is imported.
- **Errors:** a throwing entry module keeps the *previous* handler alive and prints the error — the dev process never crashes on a bad save.

#### Dev-only inspector API routes (tunnel)

Intercepted by the dev HTTP listener before the MCP handler (exact path match on the introspected `basePath`, default `/mcp`):

| Method | Path | Response |
|--------|------|----------|
| `GET` | `{basePath}/inspector/api/dev/info` | `{ mcpUrl, port, fromCli: true, tunnelUrl }` — `mcpUrl` is `{tunnelUrl}{basePath}` when a tunnel is active, else `null`; `tunnelUrl` is the public origin or `null`. |
| `POST` | `{basePath}/inspector/api/dev/start-tunnel` | `{ ok: true, restarting: false }` on success; `{ error }` with status 500 on failure. |
| `POST` | `{basePath}/inspector/api/dev/stop-tunnel` | `{ ok: true }`. |

Tunnel subdomain persistence lives at `.mcp-use/state/tunnel.json` (v1-compatible `{ subdomain }` shape). The tunnel release API base URL defaults to `https://local.mcp-use.run` and is overridable via `MCP_USE_TUNNEL_API`.

### `mcp-use start` (in `src/bin/start.ts`, statically imported by the bin)

1. Reads `.mcp-use/build/manifest.json` (consuming `entryPoint` only); if missing, an actionable error pointing at `mcp-use build`.
2. Imports the built entry, takes the default export, serves it via `listen()`.
3. **Port:** `--port` / an integer `PORT` env / `3000` — no upward probing (a production port conflict should fail, not silently move). Sets `NODE_ENV=production` only when unset.

Requires zero cli-chunk/vite/toolchain code — a production image needs only `mcp-use` and the app's own runtime deps.

## Inspector mounting (FastAPI/Swagger-UI model)

The inspector UI is **not a package dependency anywhere**. `@mcp-use/server` itself owns a tiny dependency-free HTML shell route — the exact analog of FastAPI's `get_swagger_ui_html` for `/docs`:

- `GET ${basePath}/inspector` returns a small HTML page whose `<script type="module">` loads the inspector bundle from a CDN: currently the mcp-use R2 bucket serving this branch's `build:cdn` output (the `inspector@{version}.js` + `.css` pair), **pinned to an exact version**. Moves to the jsDelivr npm copy once an inspector release ships the v2 branch's basePath-aware client (published bundles up to 12.x hardcode `/inspector` as the router basename and cannot run under `${basePath}/inspector`).
- Config (autoConnect URL = the MCP endpoint at `basePath`, plus `basePath` itself) is passed via a serialized `window` global read by the bundle.

`ServerConfig` gains:

```ts
inspector?: { enabled?: boolean; assetsUrl?: string }; // default: enabled
```

Default **enabled**, mounted in both dev and production — like FastAPI's `/docs`; users set `inspector: { enabled: false }` to disable. (Originally shipped as `boolean | { assetsUrl }`; changed to the object-only `{ enabled }` shape when `logging` landed so all on/off-with-options config reads the same way — no boolean unions.) Because the shell is just an HTML string with a CDN script tag, this does not violate the no-inspector-dependency rule.

**Known limitation, recorded honestly** (Linear MCP-2075): the full v1 inspector also expects a backend proxy route; the CDN shell in this phase is browser-only and connects directly to the same-origin MCP endpoint. Acceptable for now — the current inspector may not fully support the v2 client protocol yet; "renders and connects" is the bar.

## Offline & self-hosting

- `inspector.assetsUrl` overrides the CDN base (FastAPI's `swagger_js_url` analog) — point it at a self-hosted copy of the bundle for air-gapped environments.
- **Future (deferred, not v0):** `mcp-use dev` may detect a locally installed `@mcp-use/inspector` in the project's `node_modules` and serve its `dist/` from the dev server for fully-offline dev.
- Browsers will serve the CDN bundle from HTTP cache after first load; that's best-effort, not the offline story.

## Why the server entry reloads instead of HMR

v1's registration-HMR stack — chokidar + tsx loaders + `syncRegistrationsFrom` + per-session `sendToolListChanged` over long-lived SSE — is deliberately **not ported**. v2 statelessness removes the problem it solved:

- **The staleness problem is gone.** Every request builds a fresh server from current code (fresh-server-per-request, SPEC.md ground rules), so the next `tools/list` is always current. There is no long-lived server instance whose registrations could drift from disk.
- **There is no server state to hot-preserve.** Dev reload (the handler swap above) is reload, not HMR: no state survives a swap because no state exists.

Two adjacent things are *not* covered by this rationale and have their own posture:

- **View HMR is real HMR and arrives with views** (`VIEWS_SPEC.md` § Dev): view code is pure browser code served by a client environment on this same Vite dev server, so Vite's own HMR channel applies to it. The reload-not-HMR rule is about the *server* module graph only.
- **`list_changed` emission on reload is deferred, not rejected.** Nothing is ever stale without it (see above), but long-lived clients — an open inspector tab — would learn about a reload faster with it. It needs the notifications wiring (`handler.notify`/bus, `SPEC.md` product-shell phase) and lands there.

## Future (deferred)

- `list_changed` emission to connected clients on dev reload (with the notifications phase; see above).
- Dev side-channel for inspector auto-refresh on handler swap.
- Views + the client Vite environment (view bundling) — contract already written, `VIEWS_SPEC.md`.
- `mcp-use typegen` escape-hatch command (`VIEWS_SPEC.md` § Typegen, demoted) — explicitly never wired into `dev`/`build`/`start`.
- Local-inspector serving from `node_modules` for offline dev.
- Deploy/cloud commands.

## Open questions

- **Inspector proxy route.** The full inspector expects a backend proxy; deciding whether/where a v2 proxy route lives (server? cli chunk? inspector package serving itself?) is open — this phase ships the browser-only CDN shell.
- **Production default for the inspector.** Default-on in production mirrors FastAPI `/docs`, but whether it should become dev-only-default before GA is undecided.
