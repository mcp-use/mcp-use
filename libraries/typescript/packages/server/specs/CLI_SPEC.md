# @mcp-use/server — build/dev/start CLI spec

**Status:** Implemented (`build`/`dev`/`start` + inspector CDN shell; `examples/railway` migrated to the entry contract and verified end-to-end). Companion to `SPEC.md`; this document is the v2 build/dev/start contract (Linear MCP-2601). It records decisions already made — it is a contract, not an options memo.
**Scope:** `mcp-use build`, `mcp-use dev`, `mcp-use start`, and Inspector mounting via CDN.
**Packages:** a single package, `@mcp-use/server` — the bin, `start`, the inspector shell, *and* the `dev`/`build` toolchain (`src/cli/`), which the bin reaches only through a dynamic import (§ Package layout, below). There is no separate toolchain package; an earlier revision of this spec shipped one (provisionally named `@mcp-use/devkit`, at `packages/devkit`) and folded it back in — see "Why one package, not two" below. The old `packages/cli` stays untouched and green until cutover; nothing in it is ported wholesale.
**v1 reference:** `packages/cli` defines *what* the commands must do for users, never how. The v1 dependency cycle (`mcp-use` `bin.ts` statically imported `@mcp-use/cli`, the CLI imported `mcp-use/config`, and all three packages — including inspector — declared each other as runtime workspace deps) is the anti-pattern this spec exists to make structurally impossible.

## Goals

- Installing `mcp-use` (plus `vite` as a devDependency) makes `"dev": "mcp-use dev"`, `"build": "mcp-use build"`, `"start": "mcp-use start"` work in a user's `package.json` scripts.
- Production `mcp-use start` requires **zero** build-toolchain code — no vite, no cli chunk, nothing beyond `@mcp-use/server`'s own runtime deps.
- Command implementations are lazy-loaded per subcommand; `start` never pays for `dev`/`build` machinery.
- The inspector UI ships to users via CDN, not as a package dependency of anything.

## Non-goals (this phase)

- React/views and any client-side Vite environment (view bundling) — Phase 5 territory.
- HMR of any kind, including server-side `list_changed` notification sync (see "Why no HMR" below). Dev reload here is **reload, not HMR**.
- Typegen (watch-mode type generation is part of the Phase 5 dev contract, not this one).
- Tunnel, deploy/cloud commands, project scaffolding.
- Auth (`AUTH_SPEC.md` owns that; these commands neither add nor bypass it).

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

Migration note: `examples/railway` has been migrated to the export-default shape (its platform door is `mcp-use build` + `mcp-use start`; host selection via `RAILWAY_PUBLIC_DOMAIN` stays constructor config on the server, which `dev`/`start` honor through `listen()`).

## Package layout & dependency rules

`@mcp-use/server` ships the bin:

```jsonc
// packages/server/package.json
{ "bin": { "mcp-use": "./dist/bin.js" } }
```

`bin.ts` is tiny: it implements `start` **inline** (zero toolchain deps) and dispatches `dev` and `build` via **`await import("./cli/index.js")`** — a dynamic import of a sibling chunk *inside this same package*, built from `src/cli/*` as its own tsup entry (`dist/cli/index.js`, alongside `dist/index.js` and `dist/bin.js`; code-splitting is on specifically so this is a real separate file with a real dynamic import, not inlined into `dist/bin.js`). Nothing on the `start`/library import path (`dist/index.js`, and everything `dist/bin.js` reaches *without* going through that dynamic import) ever evaluates `src/cli/*` — and therefore never evaluates `vite`, which only `src/cli/build.ts` and `src/cli/dev.ts` import.

`vite` is declared as an **optional peer dependency**:

```jsonc
// packages/server/package.json
{
  "peerDependencies": { "vite": "^8.0.0" },
  "peerDependenciesMeta": { "vite": { "optional": true } }
}
```

Rationale: npm 7+ auto-installs a package's *required* peer dependencies, which would drag vite into every production `npm i mcp-use` — exactly what the CLI-cycle rework is trying to avoid. Marking it `optional: true` in `peerDependenciesMeta` opts out of that auto-install, so a production install without `vite` in the user's own `devDependencies` stays lean; declaring it as a peer at all (rather than omitting it entirely) also gets the *version* resolved correctly under pnpm's isolated `node_modules` layout when it is present, instead of each consumer potentially resolving a different transitive copy. `vite` is never a regular dependency of `@mcp-use/server` — regular dependencies are always installed, defeating the point.

When `vite` is missing, `src/cli/build.ts`/`src/cli/dev.ts`'s own `import { build } from "vite"` fails to resolve, and that rejection propagates up through the bin's `import("./cli/index.js")` call. The bin classifies it (`ERR_MODULE_NOT_FOUND` naming `'vite'`, via `isViteMissing` in `bin/main.ts`) and prints an actionable hint instead of a raw stack trace:

```
mcp-use dev requires Vite. Install it:
  npm i -D vite
```

**Hard rule:** `@mcp-use/server` declares **no dependency of any kind** — regular, peer, or optional — on `@mcp-use/inspector`. The inspector is reached only over HTTP (below), never imported. There is a separate, narrower invariant for the toolchain now that it lives inside this package: `vite` must never become a regular dependency, and the `src/cli/*` chunk must never be reachable from the `start` command or from this package's `"."` library export — only from the bin's `dev`/`build` dispatch.

**Why one package, not two.** An earlier revision of this spec shipped the toolchain as a separate `@mcp-use/devkit` package, reached via a `node_modules`-walking dynamic import resolved from the *user's* project (mirroring how a bare `import("@mcp-use/devkit")` inside `@mcp-use/server` could never succeed under pnpm's isolated installs, since the runtime package only sees its own declared deps). Ecosystem precedent settled on folding the toolchain into the main package instead: Astro/`skybridge`-style tools ship one core package with `vite` as a peer and `await import("vite")` internally; SvelteKit does the same (`vite` as a peer of `@sveltejs/kit`, not a separate kit-plus-vite-adapter split); Next.js ships one package and lazily imports each subcommand's machinery. Folding in gets the same "start pays nothing for the toolchain" property via a same-package dynamic import (verified structurally by the build output, not by hoping a separate package's resolution walk succeeds) while removing an entire package, its own dependency-direction rule, and its own release/version-matching surface. Ours differs from that precedent only in making the peer *optional* rather than required, for the auto-install reason above.

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
├─ build/        ← compiled server + manifest.json (this spec)
├─ generated/    ← typegen output (.d.ts) — reserved; Phase 5
├─ cache/        ← disposable dev/build scratch (vite entries, metadata)
├─ state/        ← mutable runtime state (e.g. tunnel state) — reserved; future
└─ cloud/        ← cloud linkage (link.json) — reserved; future
```

This phase writes only `build/` (and may use `cache/`); `generated/`, `state/`, and `cloud/` are **reserved by convention now** so no tool squats on them before their phases land. v1's invariant carries over: `build/` contains no mutable runtime state (that is `state/`'s job), so build output stays reproducible and disposable.

Rules, all inherited from v1 and locked:

- **No config file.** There is deliberately no `mcp-use.json` and no `outDir` knob: runtime/project configuration lives on the `MCPServer` constructor (tooling reads it by importing the entry and introspecting the instance); the `.mcp-use/` layout is fixed convention, not configuration.
- **Same names, re-declared.** The manifest basename is `manifest.json` (v1's `BUILD_MANIFEST_NAME`), the workspace dir `.mcp-use` (v1's `WORKSPACE_DIR_NAME`). `src/cli/workspace.ts` **re-declares** these constants itself — it must not import them from the old `mcp-use` package (no dependency on the old package).
- **Per-project, not global.** `.mcp-use/` is distinct from the **global** `~/.mcp-use/` directory (CLI auth, credentials, per-user caches); nothing in this spec touches the global store.

## Commands

### `mcp-use build` (in `src/cli/build.ts`, dispatched from the bin)

Vite build of the **SSR/node environment only** — no client environment exists yet (Phase 5 adds it for views). Rolldown/Vite emits the server bundle to `.mcp-use/build/` (workspace layout above) with `packages: "external"` semantics: dependencies stay external and resolve from `node_modules` at runtime; only the user's own source is bundled.

Writes `.mcp-use/build/manifest.json` (v1's `BUILD_MANIFEST_NAME`, shape compatible in spirit with the v1 manifest):

```jsonc
{ "buildId": "…", "entryPoint": "index.js", "createdAt": "…", "inspector": true }
```

**No typecheck step in v0** — deliberate. Users run `tsc --noEmit` via their own script; the build is transpile-only and fast.

### `mcp-use dev` (in `src/cli/dev.ts`, dispatched from the bin)

A single long-lived process. It:

1. Creates a Vite dev server (Environment API, node/SSR environment only) and loads the entry through the module runner.
2. Grabs the default-exported `MCPServer`, wraps `server.getHandler()` behind an **atomically swappable reference**.
3. Binds **one** `@hono/node-server` listener that delegates every request to the current handler.

On file change: Vite invalidates, dev re-imports the entry through the runner, and swaps the handler reference. No registration diffing, no MCP notifications — the next request simply hits the new handler, which is correct by construction under the stateless model.

- **Port:** `--port`, else `PORT` env, else `3000`; if taken, probe upward.
- **Host:** `127.0.0.1` by default; `--host` to override (matching the server's own localhost-first posture, SPEC.md delta 5).
- **Env:** `.env` loaded via Node's native `process.loadEnvFile()` (guarded by an `existsSync` check, since `loadEnvFile` throws on a missing file) before the entry is imported.
- **Errors:** a throwing entry module keeps the *previous* handler alive and prints the error — the dev process never crashes on a bad save.

### `mcp-use start` (inline in `@mcp-use/server` bin)

1. Reads `.mcp-use/build/manifest.json`; if missing, an actionable error pointing at `mcp-use build`.
2. Imports the built entry, takes the default export, serves it via `listen()`.
3. **Port:** `--port` / `PORT` / `3000`. Sets `NODE_ENV=production`.

Requires zero cli-chunk/vite/toolchain code — a production image needs only `mcp-use` and the app's own runtime deps.

## Inspector mounting (FastAPI/Swagger-UI model)

The inspector UI is **not a package dependency anywhere**. `@mcp-use/server` itself owns a tiny dependency-free HTML shell route — the exact analog of FastAPI's `get_swagger_ui_html` for `/docs`:

- `GET ${basePath}/inspector` returns a small HTML page whose `<script type="module">` loads the inspector bundle from a CDN: a jsDelivr/unpkg URL for `@mcp-use/inspector`'s CDN bundle (`build:cdn` output, `dist/cdn/inspector.js` — a single self-contained ESM file), **pinned to a major version** so users get inspector updates without SDK bumps.
- Config (autoConnect URL = the MCP endpoint at `basePath`, plus `basePath` itself) is passed via a serialized `window` global read by the bundle.

`ServerConfig` gains:

```ts
inspector?: boolean | { assetsUrl?: string }; // default: enabled
```

Default **enabled**, mounted in both dev and production — like FastAPI's `/docs`; users set `inspector: false` to disable. Because the shell is just an HTML string with a CDN script tag, this does not violate the no-inspector-dependency rule.

**Known limitation, recorded honestly** (Linear MCP-2075): the full v1 inspector also expects a backend proxy route; the CDN shell in this phase is browser-only and connects directly to the same-origin MCP endpoint. Acceptable for now — the current inspector may not fully support the v2 client protocol yet; "renders and connects" is the bar.

## Offline & self-hosting

- `inspector.assetsUrl` overrides the CDN base (FastAPI's `swagger_js_url` analog) — point it at a self-hosted copy of the bundle for air-gapped environments.
- **Future (deferred, not v0):** `mcp-use dev` may detect a locally installed `@mcp-use/inspector` in the project's `node_modules` and serve its `dist/` from the dev server for fully-offline dev.
- Browsers will serve the CDN bundle from HTTP cache after first load; that's best-effort, not the offline story.

## Why no HMR & no `list_changed` sync

v1's HMR stack — chokidar + tsx loaders + `syncRegistrationsFrom` + per-session `sendToolListChanged` over long-lived SSE — is deliberately **not ported**. v2 statelessness removes both halves of the problem it solved:

- **The staleness problem is gone.** Every request builds a fresh server from current code (fresh-server-per-request, SPEC.md ground rules), so the next `tools/list` is always current. There is no long-lived server instance whose registrations could drift from disk.
- **The delivery channel is gone.** No sessions and no SSE means there is nowhere to *send* a `list_changed` notification.

Dev reload (the handler swap above) is reload, not HMR: no state is preserved across swaps because there is no state. A dev-only side-channel so an open inspector tab auto-refreshes after a swap is **future work** (below), not part of this contract.

## Future (deferred)

- Dev side-channel for inspector auto-refresh on handler swap.
- Views + the client Vite environment (view bundling) — Phase 5.
- Typegen (watch-mode regeneration in `dev`) — Phase 5 dev contract.
- Local-inspector serving from `node_modules` for offline dev.
- Tunnel; deploy/cloud commands.

## Open questions

- **Inspector proxy route.** The full inspector expects a backend proxy; deciding whether/where a v2 proxy route lives (server? cli chunk? inspector package serving itself?) is open — this phase ships the browser-only CDN shell.
- **Production default for the inspector.** Default-on in production mirrors FastAPI `/docs`, but whether it should become dev-only-default before GA is undecided.
