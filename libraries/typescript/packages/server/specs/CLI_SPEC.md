# mcp-use v2 — complete CLI contract

**Status:** Implemented.
**Scope:** the complete first-party `mcp-use` CLI: `dev`, `build`, `typecheck`, `start`, cloud auth, organizations, servers, deployments, deploy, client, and screenshot; plus optional Inspector mounting in `dev` and production `start`.
**Package:** `mcp-use@2`, published from `packages/server`. The package owns the bin, runtime, command chunks, and toolchain. The development Inspector remains independently published. There is no separate CLI implementation, devkit, or config package. `@mcp-use/cli@4` is a compatibility-only proxy for the historical install command.

## Goals

- `npm install mcp-use` is sufficient for `mcp-use dev`, `mcp-use build`, and `mcp-use start`; users do not install Vite separately.
- `mcp-use start` and library imports never statically evaluate Vite or unrelated command code.
- Every substantial command is a genuine dynamically imported build chunk. `dev` and `build` are separate chunks so neither evaluates the other's machinery.
- The built-in `client` and `screenshot` commands consume independently published `@mcp-use/client` via a runtime dynamic import; it is an optional peer dependency with a clear install hint when missing. Those commands do not fold the client SDK into the framework's public library boundary.
- `mcp-use dev` can resolve a project-pinned `@mcp-use/inspector` dev dependency without adding it to the framework's production dependency graph.
- Install size, evaluated modules/startup, and production artifacts have separate measurable budgets (§ Verification and budgets).

## Non-goals (this contract)

- React/views and the client-side Vite environment (view bundling) — **`VIEWS_SPEC.md`** owns that contract. It extends this one: the views client environment joins the _same_ Vite dev server `dev` already runs, and view-file edits get real Vite HMR there. The server-entry contract below is untouched by it.
- HMR **of the server entry** — permanently. Server-entry reload is **reload, not HMR** (see "Why the server entry reloads instead of HMR" below).
- Typegen — never part of `dev`/`build`/`start`. If built at all, it is an explicit escape-hatch command (`VIEWS_SPEC.md` § Typegen, demoted), off the hot path by design.
- Project scaffolding. `create-mcp-use-app` remains a separate zero-runtime-dependency package.
- Server resource OAuth (`AUTH_SPEC.md` owns that design). CLI cloud identity commands authenticate the CLI itself and neither add nor bypass server resource authorization.

## Entry contract

The user's server entry module **default-exports the `MCPServer` instance and never calls `listen()` itself**:

```ts
// src/index.ts
import { MCPServer } from "mcp-use";
const server = new MCPServer({ name: "acme-tools", version: "1.0.0" });
server.tool(/* … */);
export default server;
```

`mcp-use dev` and `mcp-use start` own the socket. Serverless targets (Vercel, etc.) bypass the CLI entirely and export `server.fetch` from their handler file — the server stays at module scope and owns its Hono application. `mcp-use build` is the blessed path for node deployments, but `package.json` scripts are user-owned; nothing enforces it.

**Entry discovery:** conventional locations, first hit wins — `src/index.ts`, `src/server.ts`, `index.ts`, `server.ts` — overridable with `--entry <path>` on `dev`, `build`, and `typecheck`.

`examples/railway` follows this shape (its platform door is `mcp-use build` + `mcp-use start`; host selection via `RAILWAY_PUBLIC_DOMAIN` stays constructor config on the server, which `dev`/`start` honor through `listen()`).

## Command surface

The first-party command contract belongs to `mcp-use`:

- Runtime and toolchain: `dev`, `build`, `typecheck`, `start`.
- Cloud identity: `login`, `logout`, `whoami`.
- Cloud resources: `org`, `servers`, `deployments`, `deploy`.
- Local and integration workflows: `client`, `screenshot`.

For users and automation that still invoke `npx @mcp-use/cli`, the separately
published `@mcp-use/cli@4` package contains only a bin shim. It depends on the
matching `mcp-use@2` release and delegates to the framework's shipped binary.
It owns no command code or behavior; `mcp-use` remains the canonical
package and executable implementation.

There are no `ls`, `rm`, `switch`, or `install` aliases in v2 alpha. The accepted names below are the complete public surface. Cloud commands use native `fetch`, filesystem, and child-process APIs where adequate. Command-local parsing uses `node:util.parseArgs`; the package does not recreate a global Commander tree.

### Cross-command conventions

- `--help` and `--version` write to stdout and exit `0`. Bare `mcp-use --help` prints the top-level command summary; `mcp-use <command> --help` prints that command's usage. Unknown commands/options, missing arguments, invalid enum/numeric values, mutually exclusive options, and a destructive command without confirmation in a non-TTY write one concise error plus a usage hint to stderr and exit `2`.
- Successful finite commands exit `0`; empty lists and idempotent `logout`/`remove` operations are successful. Authentication, authorization, network, API, filesystem, build, MCP, browser, and remote-operation failures exit `1`. SIGINT exits `130`.
- Human output is concise UTF-8 text on stdout. Errors and warnings go to stderr. ANSI styling is used only for a TTY and honors `NO_COLOR`; machine-readable output never contains ANSI.
- Every finite data-returning command accepts `--json`. It emits exactly one JSON value followed by `\n`; errors emit `{"error":{"code":"...","message":"...","details":...}}` to stderr. Streaming `deployments logs --follow` emits JSON Lines when `--json` is set. Prompts are disabled under `--json` and whenever stdin is not a TTY.
- Destructive commands require an interactive confirmation or `--yes`. Cancellation is not an error and exits `0`; a non-TTY invocation without `--yes` is usage error `2`.
- Cloud commands that accept `--org <id-or-slug>` use it for that invocation without changing the active organization. Otherwise they use the active organization, then the account default. Ambiguous names are rejected; organization names are display-only, not selectors.
- IDs and slugs are passed as opaque strings. Pagination uses `--limit <1..100>` (default `30`) and `--skip <non-negative integer>` (default `0`). The API's returned order is preserved.

### Storage ownership and security

All global CLI state lives under `~/.mcp-use/`; project state lives under the project's `.mcp-use/` workspace:

- `~/.mcp-use/config.json` is owned by cloud commands and contains only the cloud API key plus active organization id/name/slug. `MCP_USE_CLOUD_API_URL` and `MCP_USE_CLOUD_WEB_URL` override endpoints for the process and are never persisted.
- `~/.mcp-use/client/servers.json` is owned by `client` and stores non-secret connection metadata keyed by explicit server name. There is no active/default client.
- `~/.mcp-use/client/credentials/<sha256-of-server-name>.json` stores static headers or OAuth material used by `@mcp-use/client`. Removing a saved server removes its credential file; `client <name> auth logout` removes only the OAuth material while retaining non-OAuth connection metadata.
- `~/.mcp-use/client-sdk/` is owned by `client` and `screenshot` when `@mcp-use/client` is auto-installed outside a project (for example `npx mcp-use client connect …` from a directory with no `package.json`). It holds a private `package.json` and `node_modules` for the client SDK only.
- `.mcp-use/cloud/link.json` is owned by `deploy` and contains non-secret organization/server linkage for the current project. It is the only project-local cloud state.
- Directories are created with mode `0700`, secret-bearing files with `0600`, and writes use temp-file-plus-rename. Commands never print API keys, bearer tokens, OAuth tokens, cookies, or secret environment values, including under `--json`.

### Cloud identity and organization

```text
mcp-use login [--api-key <key> | --device-code <code>] [--org <id-or-slug>] [--no-open]
mcp-use logout [--yes]
mcp-use whoami [--json]
mcp-use org list [--json]
mcp-use org current [--json]
mcp-use org use <id-or-slug>
```

- `login` uses `--api-key` or `MCP_USE_API_KEY` when present; otherwise it runs OAuth device authorization, prints the verification URL/code, and opens the URL unless `--no-open` or non-TTY. `--device-code` redeems a short-lived, pre-approved RFC 8628 device code non-interactively through the same token endpoint, then creates and validates a CLI API key before persisting it. `--api-key` and `--device-code` are mutually exclusive; an explicit `--device-code` takes precedence over `MCP_USE_API_KEY`. `--org` validates and stores the selection; without it, the account default is stored when available. Device codes and bearer credentials are never included in output or structured errors.
- `logout` deletes local cloud credentials and organization selection; remote key revocation remains a web-account action. `whoami` verifies the stored key and returns user plus active organization; missing/expired credentials exit `1` with a `mcp-use login` hint.
- `org list` returns memberships and marks the active organization. `org current` requires a resolvable active/default organization. `org use` validates membership, updates local state, and best-effort updates the account default; local success is authoritative.

### Servers, environments, and deployments

```text
mcp-use servers list [--org <id-or-slug>] [--limit <n>] [--skip <n>] [--json]
mcp-use servers get <id-or-slug> [--org <id-or-slug>] [--json]
mcp-use servers update <id-or-slug> [--org <id-or-slug>]
  [--name <name>] [--description <text>] [--branch <name>]
  [--root-dir <path>] [--build-command <cmd>] [--start-command <cmd>]
mcp-use servers delete <id-or-slug> [--org <id-or-slug>] [--yes]
mcp-use servers env list <server> [--org <id-or-slug>] [--branch <name>] [--json]
mcp-use servers env set <server> <KEY=VALUE> [--org <id-or-slug>]
  [--branch <name>] [--secret]
mcp-use servers env unset <server> <key> [--org <id-or-slug>]
  [--branch <name>] [--yes]

mcp-use deployments list [--org <id-or-slug>] [--server <id-or-slug>]
  [--limit <n>] [--skip <n>] [--json]
mcp-use deployments get <deployment-id> [--json]
mcp-use deployments logs <deployment-id> [--build] [--follow] [--json]
mcp-use deployments restart <deployment-id> [--branch <name>] [--follow]
mcp-use deployments stop <deployment-id> [--yes]
mcp-use deployments delete <deployment-id> [--yes]
```

- `servers update` requires at least one mutation option. An empty `--root-dir`, `--build-command`, or `--start-command` clears that override. Creating servers is owned by `deploy`.
- Environment scope defaults to the server's production environment; `--branch` selects that branch's preview environment. `set` is an upsert. Values are never returned by `list`; it reports key, scope, sensitivity, and update metadata only. v2 drops separate add/update commands and environment-tag filtering.
- `deployments logs` defaults to runtime logs; `--build` selects build logs. `--follow` streams until the deployment reaches a terminal state or the user interrupts. `restart --follow` follows the newly created deployment's build logs.
- v2 omits the nonfunctional `deployments start` command. A stopped deployment is resumed by `restart`.

### Deploy

```text
mcp-use deploy [path] [--org <id-or-slug>] [--name <name>]
  [--branch <name>] [--root-dir <path>] [--region <region>]
  [--env <KEY=VALUE>...] [--env-file <path>]
  [--build-command <cmd>] [--start-command <cmd>] [--dockerfile <path>]
  [--new] [--open] [--yes] [--json]
```

- `path` defaults to cwd. The project must be a Git repository with a supported GitHub remote. First deploy creates a Git-backed server; subsequent deploys reuse `.mcp-use/cloud/link.json`. `--new` ignores existing linkage and creates a new server after confirmation.
- The branch defaults to the current branch. `--root-dir` and `--dockerfile` are repository-relative and must not escape the repository. Repeated `--env` values override duplicate keys from `--env-file`; values are uploaded but never echoed. Region values are API-supported region identifiers and are validated before upload.
- The command does not create repositories, initialize Git, commit, push, install/configure the GitHub App, or upload an alternate platform-managed source tarball. Missing GitHub access fails with the exact installation/configuration URL and retry instructions; it never prompts or polls for external setup.
- Success writes the project link atomically and returns server id, deployment id, status, and URLs. `--open` is best-effort after successful deployment and never changes a successful exit to failure.

### Client

```text
mcp-use client connect <name> <url> [-H, --header <"Key: Value">...]
  [--no-oauth] [--auth-timeout <ms>] [--protocol <auto|2026-07-28|2025-11-25>]
  [--no-open] [--json]
mcp-use client list [--json]
mcp-use client remove <name>
mcp-use client <name> tools list [--json]
mcp-use client <name> tools describe <tool> [--json]
mcp-use client <name> tools call <tool> [args...] [--timeout <ms>] [--json]
mcp-use client <name> resources list [--json]
mcp-use client <name> resources read <uri> [--json]
mcp-use client <name> prompts list [--json]
mcp-use client <name> prompts get <prompt> [args...] [--json]
mcp-use client <name> auth status [--json]
mcp-use client <name> auth logout [--yes] [--json]
```

- v2 alpha client commands support HTTP(S) MCP servers; stdio, interactive REPL, resource subscriptions, implicit active sessions, and forced OAuth refresh are omitted. Every operation names a saved server.
- `connect` validates a unique filesystem-safe name, connects before saving, and attempts OAuth on an authorization challenge unless `--no-oauth`. In an interactive TTY, OAuth prints `This server requires OAuth. Press Enter to open your browser.`, waits for Enter, and then opens the browser. `--no-open`, `--json`, and non-TTY operation never prompt or open a browser; they print the authorization URL to stderr while the loopback callback continues to wait. Repeated headers are stored as credentials, not metadata. Reusing a name requires removing it first.
- `client` and `screenshot` dynamic-import `@mcp-use/client`. When it is missing, the CLI installs it automatically: into the nearest project `package.json` when one exists, otherwise into `~/.mcp-use/client-sdk/`. Auto-install continues the current command in-process and imports from the install location.
- Tool/prompt arguments accept either one JSON object or `key=value` pairs; `key:=<json>` supplies typed JSON values. Mixing the full-object and pair forms is usage error `2`. Calls time out with exit `1`; tool `isError` results are operation failures and retain their protocol content in JSON error details.
- `client remove` immediately and idempotently deletes the named local server metadata and credentials. It does not prompt, and `--yes` is not a supported option.
- Default human output renders borderless terminal lists and readable MCP content; tool lists format described tools as `<name> - <description>`. Every client command that advertises `--json` accepts it anywhere after `client`. `--json` emits exactly one value to stdout: the raw protocol result envelope for calls, reads, and prompts; the described tool object for `tools describe`; arrays for lists; and command result objects for connect and auth commands. Errors emit exactly one JSON error envelope to stderr and no stdout value.

### Screenshot

```text
mcp-use screenshot (--server <name> | --mcp <url>) --tool <name> [args...]
  [-H, --header <"Key: Value">...] [--output <path>]
  [--width <px>] [--height <px>] [--device-scale-factor <n>]
  [--theme <light|dark>] [--inspector <url>] [--cdp-url <ws-or-wss-url>]
  [--wait-for <selector>] [--delay <ms>] [--timeout <ms>] [--json]
```

- Exactly one target is required. `--server` reuses saved client auth; `--header` is valid only with `--mcp`. `--tool` must advertise an MCP Apps UI resource. Arguments use the client command's JSON/pair grammar.
- The CLI calls the tool and reads the UI resource through `@mcp-use/client`, then injects the result into the browser preview; credentials and tokens are never passed to browser JavaScript. The default inspector is the framework-compatible hosted preview. `--inspector` may select another compatible HTTP preview; the command never imports or auto-spawns `@mcp-use/inspector`.
- A compatible preview origin implements protocol `mcp-use-inspector-preview` version `1`. `GET <origin>/inspector/health` returns `{ "status": "ok", "protocol": "mcp-use-inspector-preview", "version": 1, "capabilities": ["view-preview"] }`. Any missing field, different protocol/version, or absent `view-preview` capability is rejected before tool execution.
- The browser navigates to `<origin>/inspector/preview/<percent-encoded-view-name>?protocol=1`. Before navigation, the CLI registers the already-fetched resource document, tool input, tool result, host context, and theme through CDP's new-document script API; the URL receives no MCP URL, headers, credentials, or result payload. The preview sets `document.body.dataset.viewReady = "true"` only after the app handshake and first stable render, or `document.body.dataset.viewError` to a non-secret error code on failure. The CLI waits for exactly one signal and treats simultaneous, malformed, or timed-out state as an inspector compatibility failure.
- Without `--cdp-url`, the command uses an installed Chromium-family browser or exits `1` with installation guidance. Omitted dimensions use the rendered view's natural size. Device scale factor defaults to `1` and must be greater than `0` and at most `4`. Output defaults to `./<view>-<timestamp>.png`; an existing explicit path is replaced.
- Success prints the absolute output path; `--json` emits `{ "path", "width", "height", "deviceScaleFactor" }`. Browser readiness/timeout, missing UI metadata, tool failure, and write failure exit `1`.

## Package layout & dependency rules

`mcp-use` ships the bin:

```jsonc
// packages/server/package.json
{ "bin": { "mcp-use": "./dist/bin.js" } }
```

The framework bin is a tiny proxy to the prebuilt `@mcp-use/cli` package. `@mcp-use/cli` exposes a side-effect-free programmatic `main(argv, { frameworkVersion })` entry: the framework bin injects the version compiled from the `mcp-use` manifest, while the standalone CLI bin injects the `@mcp-use/cli` manifest version. This keeps `mcp-use --version` correct even when the independently published packages have deliberately different versions. The CLI dispatches every substantial command with `await import(...)` to a real sibling chunk built with code splitting enabled. At minimum the CLI output has distinct chunks for `start`, `dev`, `build`, cloud identity, organizations, servers, deployments, deploy, client, and screenshot.

`mcp-use/dist/index.js`, `mcp-use/dist/react/index.js`, and the CLI `start` dispatch chunk have no static import path to Vite. The `start` dispatch chunk is an edge-safe dynamic bridge: its static graph also contains no Node builtins, Client SDK, v1 SDK, or unrelated command. The Node-only production listener is loaded only after `start` is invoked. Vite imports live only in the CLI command chunks that use them; `dev` and `build` are separate so loading one does not evaluate the other. Structural build-output tests enforce these boundaries rather than relying on source naming.

`mcp-use` owns the server build configuration. When views are present, it loads the project's optional `vite.config.*` for the views client environment only, then injects the framework's built-in Tailwind, React, and views plugins. Every virtual view entry imports the framework's virtual Tailwind stylesheet, so utility classes work without a project CSS import, dependency, or config. A project config is only for additional client plugins and aliases and cannot alter the server build.

Vite is a **regular dependency** of `@mcp-use/cli`, which is a regular dependency of `mcp-use`:

```jsonc
// packages/server/package.json and packages/cli/package.json
{
  "mcp-use": { "dependencies": { "@mcp-use/cli": "…" } },
  "@mcp-use/cli": { "dependencies": { "vite": "^8.0.0" } },
}
```

Vite is framework implementation machinery: the package owns the compatible version and one install must provide the complete dev/build experience. Dependency installation and runtime evaluation are separate concerns; lazy chunks keep production startup lean even though Vite is installed. When views land, `@vitejs/plugin-react` is also a regular dependency. `react` and `react-dom` remain optional peers because applications own their singleton versions.

`@mcp-use/client` is an optional peer at a compatible published version (`^2.0.0-alpha.0`). It remains independently published and independently installable; `mcp-use client` and `mcp-use screenshot` dynamic-import it and print install instructions when it is absent. Server library exports do not re-export or absorb the SDK.

`mcp-use` declares `@mcp-use/inspector` as a regular dependency so the local Inspector and screenshot preview always match the framework release. The Inspector package itself has zero regular dependencies and ships its standalone browser application prebuilt and compressed. `@mcp-use/cli` declares both `@mcp-use/client` and `@mcp-use/inspector` as optional peers: the framework satisfies the Inspector peer, while Client-only commands retain their explicit opt-in behavior.

Target user `package.json` shape:

```jsonc
{
  "scripts": {
    "dev": "mcp-use dev",
    "build": "mcp-use build",
    "start": "mcp-use start",
  },
  "dependencies": { "mcp-use": "^2" },
}
```

**Workspace self-reference.** Until cutover, `packages/server/package.json` and in-workspace fixtures use the private name `mcp-use`; its self-referencing devDependency is `"mcp-use": "workspace:*"`. Clean-pack tests rewrite/publish the candidate as `mcp-use` and exercise the target public imports from an external temporary project. Relative fixture imports and test-only Vite aliases are forbidden because they bypass package resolution.

## Workspace layout (`.mcp-use/`)

`.mcp-use/` is the per-project, fixed-convention, gitignored workspace — the `.next` analog. Everything tooling writes for a project lives under it, a checkout stays clean, and `rm -rf .mcp-use` is always safe:

```
.mcp-use/
├─ build/        ← compiled server + start manifest; build/views/ carries production view bundles and public assets
├─ generated/    ← output of the typegen escape-hatch command — reserved (VIEWS_SPEC.md § Typegen, demoted)
├─ cache/        ← disposable dev/build scratch (vite cacheDir)
├─ state/        ← mutable runtime state (e.g. tunnel.json)
└─ cloud/        ← deploy linkage (link.json)
```

This contract writes `build/` (using `cache/` as Vite's `cacheDir`), `state/tunnel.json` during tunneled dev, and `cloud/link.json` after deploy. `generated/` is reserved for the explicit typegen escape hatch. `build/` contains no mutable runtime state, so build output stays reproducible and disposable. Because everything under `.mcp-use/` is gitignored and `rm -rf`-safe, nothing committed ever lives here. The root-level `mcp-env.d.ts` typing shim belongs in the project source tree and is scaffolded by every first-party template. `dev`, `build`, and `typecheck` reconcile declarations carrying an mcp-use generated header with the discovered entry path; a declaration without that marker is user-owned and never overwritten (`VIEWS_SPEC.md` § Typing).

Rules, all inherited from v1 and locked:

- **No config file.** There is deliberately no `mcp-use.json` and no `outDir` knob: runtime/project configuration lives on the `MCPServer` constructor (tooling reads it by importing the entry and introspecting the instance); the `.mcp-use/` layout is fixed convention, not configuration.
- **Same names, re-declared.** The manifest basename is `manifest.json` (v1's `BUILD_MANIFEST_NAME`), the workspace dir `.mcp-use` (v1's `WORKSPACE_DIR_NAME`). `src/cli/workspace.ts` **re-declares** these constants itself — it must not import them from the old `mcp-use` package (no dependency on the old package).
- **Per-project, not global.** Project build/linkage state lives in `.mcp-use/`; cloud identity and saved-client state live in the explicitly owned global paths under `~/.mcp-use/` defined above. Neither side scans or writes outside its declared paths.

## Commands

### `mcp-use typecheck` (in `src/cli/typecheck.ts`, dispatched from the bin)

Discovers the server entry with the same `--path`, `--entry`, and `--mcp-dir` rules as `dev`/`build`, reconciles the managed root `mcp-env.d.ts`, then resolves `typescript` from the selected project and invokes its `tsc` binary with `--noEmit`. This preserves the project's compiler version and plugins; the CLI does not bundle TypeScript. Arguments after `--` are forwarded to `tsc`, and the command returns the compiler's exit code. Missing TypeScript or entry discovery failures exit `1` with an actionable error.

The command does not inspect or execute the server and does not generate tool-specific types. Its only type preparation is keeping the constant `typeof import("./entry.js")` bridge current. Templates commit that bridge, so editor typechecking and a direct `tsc --noEmit` also work before any mcp-use command has run. No install or postinstall lifecycle hook is involved.

### `mcp-use build` (in `src/cli/build.ts`, dispatched from the bin)

Vite emits the server bundle to `.mcp-use/build/` with `ssr: { external: true }`: every bare import stays external and resolves from `node_modules` at runtime; only the user's source is bundled. Output is unminified ESM targeting the package's Node floor. `--source-maps` emits the server map and external view maps; inline view maps remain disabled to keep inline resources free of source payload and external map dependencies. When views exist, `VIEWS_SPEC.md` adds one client build per view plus a generated server wrapper that embeds the view asset registry.

Writes `.mcp-use/build/manifest.json`:

```jsonc
{
  "buildId": "…",
  "entryPoint": "index.js",
  "createdAt": "…",
  "views": {},
}
```

`buildId` is a random hex id and `createdAt` is an ISO timestamp. The file contains no Inspector flag. `views` contains the mode-neutral registry for runtime adapters; `start` consumes `entryPoint` and relies on the generated wrapper's embedded copy. By default, view entries reference external asset paths. `mcp-use build --inline` instead embeds each view's bundled JavaScript and CSS so `resources/read` returns them directly in the HTML document. There is no `--no-inline`; omitting `--inline` keeps the default external-assets mode. Every build copies project-root `public/` into `build/views/public/` when present, including tool-only servers and inline builds whose views reference public files.

When `MCP_ASSETS_URL` is set during a default external views build, the embedded view asset paths become full CDN URLs containing the server entry's `basePath`. The CLI leaves `build/views/` on disk and prints an upload instruction; it does not upload files. Inline builds do not rewrite embedded JS/CSS; `MCP_ASSETS_URL` can still select the host for copied `public/` files at runtime. Runtime env uses `MCP_URL` for the server origin, `MCP_ASSETS_URL` for asset and public-file URLs, and `CSP_URLS` / `CSP_*_DOMAINS` for global CSP.

The build is transpile-only and does not run a typecheck. First-party templates expose `mcp-use typecheck` as their project-owned `typecheck` script.

### `mcp-use dev` (in `src/cli/dev.ts`, dispatched from the bin)

A single long-lived process. It:

1. Creates a Vite dev server (Environment API, node/SSR environment only) and loads the entry through the module runner.
2. Grabs the default-exported `MCPServer`, injects the process-scoped event bus through its internal CLI lifecycle hook, and wraps `server.fetch` behind an **atomically swappable reference**.
3. Binds **one** Node HTTP listener (vendored `toNodeHandler` bridge) that delegates every request to the current handler.
4. Unless `--no-inspector` is set, resolves `@mcp-use/inspector` from the project and calls its framework-neutral `mountInspector()` on that same listener. Missing optional tooling does not stop the MCP server; one package-manager-aware install hint is printed instead.

On file change (only files in the entry's module graph count): Vite invalidates, dev re-imports the entry through the runner, and swaps the handler reference. There is no registration diffing: the next request hits the new handler, which is correct by construction under the stateless model. Every handler generation shares one process-scoped SDK `ServerEventBus`; after a successful swap, dev publishes `tools/list_changed`, `prompts/list_changed`, and `resources/list_changed`. Modern clients with an open `subscriptions/listen` stream therefore refetch the authoritative lists from the new handler. Publishing all three is deliberate invalidation, not change detection — the protocol carries no delta, and avoiding schema/function comparison keeps server reload independent of registry internals. A failed reload keeps the old handler and publishes nothing. Stateless legacy clients receive no push but remain correct on their next manual list request.

- **Port:** `--port`, else integer `PORT` env, else `3000`; if the preferred port cannot be bound on the listen host, or (on localhost-class binds) something already accepts connections on loopback, probe upward.
- **Host:** `--host`, else non-empty `HOST` env, else `127.0.0.1` (matching the server's own localhost-first posture, SPEC.md delta 5). Printed and auto-opened URLs use the browsable equivalent: `localhost` for loopback/wildcard binds, the given host verbatim otherwise; wildcard binds additionally print a `Network:` line with the machine's LAN address.
- **DNS-rebinding protection:** `server.fetch` deliberately applies no Host/Origin validation by default (its contract assumes a platform edge in front) — in dev, this process is the edge. On localhost-class binds the listener validates `Host` against the localhost allowlist plus the active tunnel hostname (tunnel traffic arrives with the tunnel's public Host), rejecting with the SDK's JSON-RPC 403 shape _before_ any routing, so the MCP endpoint, the dev API routes, and Vite-served module URLs are all covered. Origin is not validated unless the server's `allowedOrigins` is set (SDK-aligned default). Rebinding manifests as a non-localhost `Host`; sandboxed view iframes have an opaque origin, so their module/asset GETs legitimately carry `Origin: null`. Those loads also run in CORS mode, so they need `Access-Control-Allow-Origin`: the MCP server's view asset and public routes (mounted in both dev and production) always emit `*`. Vite-served module URLs (checked per request, so runtime tunnel start/stop takes effect immediately): while a tunnel is active, emit `*` so foreign and opaque-origin hosts can fetch the module graph; without a tunnel on a localhost bind, reflect a validated loopback `Origin` (exact request origin — `localhost` / `127.0.0.1` / `[::1]`, any port/scheme accepted by `validateOriginHeader` against `localhostAllowedOrigins()`) and merge `Vary: Origin`, so a local MCP host (e.g. inspector at `http://localhost:6274`) can load modules while foreign origins, `Origin: null`, and missing Origin get no ACAO and the source module graph stays unreadable to arbitrary websites. Vite's own CORS middleware is disabled (`cors: false`) so its localhost-only default neither blocks tunnel-rendering hosts nor fights the gated header. Non-localhost binds get no validation (the legitimate hostnames are unknowable) and print a warning instead.
- **Tunnel:** `--tunnel` starts a public tunnel as soon as the HTTP listener is bound (via `npx @mcp-use/tunnel`). The inspector UI can also start/stop the tunnel at runtime through dev-only API routes (below) without restarting the dev process.
- **Auto-open:** when the project-local Inspector mounted successfully, its URL is opened in the default browser through a dependency-free, shell-free platform launcher. Only absolute HTTP(S) URLs without URL credentials are accepted. `--no-open` disables it, and it is skipped automatically when stdout is not a TTY, so agents/CI never trigger a browser launch or see a "failed to open" error. A missing or explicitly disabled Inspector is never opened.
- **Env:** `.env` loaded via Node's native `process.loadEnvFile()` (guarded by an `existsSync` check, since `loadEnvFile` throws on a missing file) before the entry is imported.
- **Errors:** a throwing entry module keeps the _previous_ handler alive and prints the error — the dev process never crashes on a bad save.

#### Dev-only inspector API routes (tunnel)

Intercepted by the dev HTTP listener before the MCP handler (exact path match on the introspected `basePath`, default `/mcp`):

| Method | Path                                        | Response                                                                                                                                                             |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `{basePath}/inspector/api/dev/info`         | `{ mcpUrl, port, fromCli: true, tunnelUrl }` — `mcpUrl` is `{tunnelUrl}{basePath}` when a tunnel is active, else `null`; `tunnelUrl` is the public origin or `null`. |
| `POST` | `{basePath}/inspector/api/dev/start-tunnel` | `{ ok: true, restarting: false }` on success; `{ error }` with status 500 on failure.                                                                                |
| `POST` | `{basePath}/inspector/api/dev/stop-tunnel`  | `{ ok: true }`.                                                                                                                                                      |

Tunnel subdomain persistence lives at `.mcp-use/state/tunnel.json` (v1-compatible `{ subdomain }` shape). The tunnel release API base URL defaults to `https://local.mcp-use.run` and is overridable via `MCP_USE_TUNNEL_API`.

### `mcp-use start` (in its own lazy command chunk)

1. Reads `.mcp-use/build/manifest.json` (consuming `entryPoint` only); if missing, an actionable error pointing at `mcp-use build`.
2. Imports the built entry, takes the default export, serves it via `listen()`.
3. **Address:** CLI flag / environment variable / built server configuration / default: `--port` / integer `PORT` / `config.port` / `3000`, and `--host` / non-empty `HOST` / `config.host` / `127.0.0.1`. There is no upward port probing (a production port conflict should fail, not silently move). Sets `NODE_ENV=production` only when unset.
4. **Inspector:** `--with-inspector` lazily imports the bundled `@mcp-use/inspector`, mounts it at `${basePath}/inspector` on the same listener, and leaves the build output and manifest unchanged. The default start path neither imports nor exposes Inspector routes. The listener continues through `MCPServer.listen()` so its Host validation and OAuth resource initialization are identical in both modes; production Inspector proxy routes disallow loopback targets.
5. **Tunnel:** `--tunnel` dynamically loads the shared tunnel manager only after `listen()` binds successfully, including when `--with-inspector` owns additional routes on that listener. It targets the actual bound port, reuses `.mcp-use/state/tunnel.json`, derives the public MCP endpoint from the server's returned endpoint path, and stops/releases the tunnel before closing the server on normal shutdown, SIGINT, or SIGTERM. A tunnel startup failure closes the already-bound server and fails the command.

Without `--tunnel`, the tunnel module is not evaluated. `start` evaluates no Vite, toolchain, or unrelated command chunk. A production image installs `mcp-use` and the app's own runtime dependencies; the regular Vite dependency may be present on disk but is outside the `start` evaluation graph.

## Inspector mounting

The Inspector is development tooling by default. `mcp-use` installs the optimized `@mcp-use/inspector` package directly; generated projects do not need another Inspector declaration. `mcp-use start --with-inspector` is the explicit production-listener opt-in.

Both embedded mounts (`mcp-use dev` and `mcp-use start --with-inspector`) forward the `MANUFACT_CHAT_URL` environment variable to `mountInspector`, which injects it as `window.__MANUFACT_CHAT_URL__` so the hosted-chat endpoint is configured at runtime without rebuilding the Inspector bundle. When it is unset, the Inspector falls back to its build-time default.

`mcp-use dev` resolves a project-declared Inspector override first and otherwise loads the framework dependency, calls `mountInspector({ basePath, autoConnectUrl, devMode: true, oauthProxyAllowLoopback, manufactChatUrl })`, and dispatches `${basePath}/inspector/**` to the returned Fetch handler before the MCP handler. The handler is rebuilt atomically when a successful entry reload changes `basePath`. The Inspector package exclusively owns its bundled UI assets, Hono implementation, MCP relay, OAuth BFF, callback, and health/config routes; `mcp-use` owns loading, route delegation, tunnel controls, and browser lifecycle.

The returned mount serves the exact UI bundle shipped in the installed package under `${basePath}/inspector/assets/**`; it never resolves jsDelivr or honors a CDN override. Thus local development works offline after dependency installation and the UI/backend contract cannot drift independently of the lockfile.

The Inspector surface and dev-control routes are not exposed through a public `mcp-use dev` tunnel. A wildcard bind serves them only to loopback Host values; the public tunnel and LAN-facing wildcard hosts expose the MCP endpoint and required view assets, not a loopback-capable proxy into the developer machine. An explicitly selected non-loopback bind may expose the Inspector but disables loopback proxy targets and already carries the CLI's network-exposure warning.

`server.fetch`, `listen()`, and `mcp-use build` do not mount an Inspector shell or proxy. Plain `mcp-use start` also returns `404` for `GET ${basePath}/inspector`; only `mcp-use start --with-inspector` mounts it. Standalone inspection of arbitrary endpoints remains explicit: `npx @mcp-use/inspector --url <mcp-url>`.

## Why the server entry reloads instead of HMR

v1's registration-HMR stack — chokidar + tsx loaders + `syncRegistrationsFrom` + per-session `sendToolListChanged` over long-lived SSE — is deliberately **not ported**. v2 statelessness removes the problem it solved:

- **The staleness problem is gone.** Every request builds a fresh server from current code (fresh-server-per-request, SPEC.md ground rules), so the next `tools/list` is always current. There is no long-lived server instance whose registrations could drift from disk.
- **There is no server state to hot-preserve.** Dev reload (the handler swap above) is reload, not HMR: no state survives a swap because no state exists.

Two adjacent things are _not_ covered by this rationale and have their own posture:

- **View HMR is real HMR and arrives with views** (`VIEWS_SPEC.md` § Dev): view code is pure browser code served by a client environment on this same Vite dev server, so Vite's own HMR channel applies to it. The reload-not-HMR rule is about the _server_ module graph only.
- **`list_changed` is an invalidation after the swap, not registry HMR.** One SDK event bus is shared by every stateless handler generation, preserving open modern subscriptions across reloads. The three list-change events make long-lived clients such as the inspector refetch from the new handler; they never mutate or synchronize the old server instance.

## Verification and budgets

Budgets are measured on Linux x64 in the CI-pinned Node 22.23 container image; the baseline records the exact image digest, Node version, and npm version. The test packs the candidate, installs that tarball with `npm install --omit=dev` in an empty project, and sums logical file bytes without filesystem block rounding.

| Dimension                                                                  | Hard ceiling |
| -------------------------------------------------------------------------- | -----------: |
| packed `.tgz` bytes                                                        |        2 MiB |
| package `unpackedSize` from `npm pack --json`                              |        5 MiB |
| clean-install `node_modules` bytes (including Vite/platform optional deps) |      110 MiB |
| edge-safe `dist/index.js` bytes                                            |       80 KiB |
| aggregate native static graph rooted at `dist/index.js`                    |      120 KiB |
| tool-only `.mcp-use/build/` fixture                                        |        1 MiB |
| committed basic-view fixture output (external JS + CSS before compression) |      2.5 MiB |

Production JavaScript is syntax- and whitespace-minified without identifier mangling. Source maps are omitted by default and are emitted only when the user passes `--source-maps`. Installed bytes are an on-disk distribution concern; they do not count modules evaluated at runtime. Evaluation has separate tests:

- A parsed ESM-import walker recursively follows every relative static import from `dist/index.js`, including minified imports. It must reach no `dist/commands/**`, `vite`, `@vitejs/**`, `@mcp-use/client`, v1 `@modelcontextprotocol/sdk`, `express`, or Node builtins (`fs`, `path`, `stream`, `node:*`, …). `listen()` and view public assets may lazy-load Node modules via dynamic `import()` only (including `./node-bridge.js` for the HTTP adapter).
- The parsed traversal for `dist/commands/start.js` remains entirely within the edge-safe dispatch bridge. The dynamically imported production start runtime may load its documented Node modules, but it must not load Vite, Client SDKs, v1 SDK, `dev`, `build`, or any unrelated command.
- Runtime tracing of `import "mcp-use"` under `--conditions=workerd` permits zero Node builtins. Under default Node conditions, the only permitted builtin is the official SDK's `node:process` import from `shimsNode.mjs`; it is optional when that SDK version does not evaluate the shim.
- Runtime tracing of `mcp-use start` allows the production listener's documented Node modules while rejecting Vite, Client SDKs, v1 SDK, `dev`, `build`, and unrelated commands.

`tests/budgets/cli-budget.test.ts` enforces the built import graph and unpacked framework ceiling. Release CI packs the candidate, installs it with the matching packed `@mcp-use/client`, and enforces the packed and clean-install ceilings. Fixture build tests enforce server/view artifact ceilings.

Clean-install tests run `npm install <packed-tarball>` followed by `mcp-use --version`, `dev`, `build`, and `start`. A deliberately mismatched framework/CLI pair must report the installed framework manifest from the framework bin and the CLI manifest from the standalone bin. The physical npm graph must contain one version of each package and exactly one v2 MCP Client/Core/Server set, with no v1 `@modelcontextprotocol/sdk` and no invalid `pkg.pr.new` metadata warning. The only accepted extraneous packages are `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`, and `tslib`, and each is accepted only when its lockfile entry is marked optional. Boundary tests also cover a client-only install of `@mcp-use/client`, `dev` with and without a project-local `@mcp-use/inspector`, standalone Inspector operation without `mcp-use`, production absence of Inspector routes, and the zero-runtime-dependency `create-mcp-use-app` smoke matrix.
