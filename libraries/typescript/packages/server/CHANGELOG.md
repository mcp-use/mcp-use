# mcp-use

## 2.0.0-beta.55

### Patch Changes

- 1dd88c2: Ship the self-contained, Node-optimized runtime entry with package-size
  verification calibrated for the additional Node bundle and coverage that
  prevents undeclared runtime dependencies from escaping the bundle.
  - @mcp-use/inspector@20.0.0-beta.47

## 2.0.0-beta.54

### Patch Changes

- a7dd305: Reduce v2 Node server startup and request overhead with a conditioned,
  self-contained Node entry, buffered JSON response writes, and narrower
  JSON-RPC response guards. Preserve the Node-free edge entry, streaming
  responses, middleware behavior, and protocol validation.
- ae9065a: Keep provider-specific JWT audiences separate from the canonical MCP resource. Restore Supabase's `authenticated` audience and Clerk's optional audience/issuer-bound token verification while continuing to reject mismatched explicit resource claims.
  - @mcp-use/inspector@20.0.0-beta.46

## 2.0.0-beta.53

### Patch Changes

- Updated dependencies [af09aee]
  - @mcp-use/inspector@20.0.0-beta.45

## 2.0.0-beta.52

### Patch Changes

- 6a647f9: Add scoped `--help` and `-h` pages for every `mcp-use client` command family and leaf without loading saved connections or the client SDK.
  - @mcp-use/inspector@20.0.0-beta.44

## 2.0.0-beta.51

### Patch Changes

- Updated dependencies [da86879]
  - @mcp-use/inspector@20.0.0-beta.43

## 2.0.0-beta.50

### Patch Changes

- 44182d0: Replace date-based `mcp-use client --protocol` values with `auto`, `legacy`,
  and `modern`. The named modes select automatic negotiation, the legacy wire,
  or the stateless and sessionless modern wire without fallback.
  - @mcp-use/inspector@20.0.0-beta.42

## 2.0.0-beta.49

### Patch Changes

- 9eb99e4: Allow tool-only servers to build and run without a views directory or React
  view component.

  `mcp-use build` and `mcp-use dev` now prime and validate an empty view registry,
  log when the views directory is not configured, and preserve the precise
  view-binding error when a tool references a view that does not exist.

- Updated dependencies [9eb99e4]
  - @mcp-use/cli@4.0.0-beta.12
  - @mcp-use/inspector@20.0.0-beta.41

## 2.0.0-beta.48

### Patch Changes

- e802317: Remove saved client servers immediately without confirmation and reject unsupported `--yes` and `--json` flags.
  - @mcp-use/inspector@20.0.0-beta.40

## 2.0.0-beta.47

### Minor Changes

- 137a936: Add a temporary v1 drop-in compatibility entry for migrating existing servers to v2 without rewriting server code.

  **mcp-use**
  - Add deprecated `mcp-use/server` export backed by the native stateless v2 server, preserving common v1 tool, resource, template, prompt, OAuth, OpenAPI, and response-helper shapes.
  - Teach `mcp-use dev`, `build`, and `start` to detect the compatibility server, load legacy widget metadata, and prime views through the v2 manifest pipeline.
  - Add deprecated React compatibility exports under `mcp-use/react` for legacy widget hooks and components.
  - Document the migration bridge in `v2-MIGRATION.md` and `v2-DROP-IN-PLAN.md`.

  The compatibility entry is intentionally isolated from the native root bundle so v2 import paths keep their existing size budgets. It will be removed in mcp-use v3.

### Patch Changes

- @mcp-use/inspector@20.0.0-beta.39

## 2.0.0-beta.46

### Patch Changes

- Updated dependencies [24d2024]
  - @mcp-use/inspector@20.0.0-beta.38

## 2.0.0-beta.45

### Patch Changes

- a3edf35: Provide Vite client types through `mcp-use` so generated projects can import CSS, SVG, and other supported assets without maintaining custom declarations or depending directly on Vite.
- Updated dependencies [a3edf35]
  - @mcp-use/cli@4.0.0-beta.11
  - @mcp-use/inspector@20.0.0-beta.37

## 2.0.0-beta.44

### Minor Changes

- e53c958: Add `mcp-use login --device-code <code>` for securely redeeming short-lived, pre-approved device codes in non-interactive onboarding flows.

### Patch Changes

- Updated dependencies [e53c958]
  - @mcp-use/cli@4.0.0-beta.10
  - @mcp-use/inspector@20.0.0-beta.36

## 2.0.0-beta.43

### Patch Changes

- a0501f8: Track anonymous, content-free adoption of public React hooks inside MCP Views.
  - @mcp-use/inspector@20.0.0-beta.35

## 2.0.0-beta.42

### Patch Changes

- ac3d1eb: Harden browser launching, Inspector routes, and browser persistence. OAuth
  session values are encrypted at rest, secret connection fields are no longer
  persisted, Inspector assets and proxy/OAuth APIs are rate-limited, and CLI
  browser opening now validates HTTP(S) targets and uses shell-free launchers.
- Updated dependencies [ac3d1eb]
  - @mcp-use/inspector@20.0.0-beta.34

## 2.0.0-beta.41

### Minor Changes

- c991412: Remove the `mcp-use skills` command from the CLI. Coding-agent skills remain
  available through the `create-mcp-use-app` setup flow.

### Patch Changes

- Updated dependencies [c991412]
  - @mcp-use/cli@4.0.0-beta.9
  - @mcp-use/inspector@20.0.0-beta.33

## 2.0.0-beta.40

### Patch Changes

- Updated dependencies [042a082]
  - @mcp-use/inspector@20.0.0-beta.32

## 2.0.0-beta.39

### Patch Changes

- Updated dependencies [fa40e85]
  - @mcp-use/inspector@20.0.0-beta.31

## 2.0.0-beta.38

### Patch Changes

- 066f449: Report the published package version in anonymous SDK usage metrics by rebuilding
  prerelease artifacts after package versioning and before publication.
  - @mcp-use/inspector@20.0.0-beta.30

## 2.0.0-beta.37

### Patch Changes

- 5d70398: Add anonymous v2 server usage metrics for server composition, feature adoption,
  client protocol capabilities, and sampled operation outcomes. Persist a random
  per-server identity in the project's gitignored `.mcp-use/usage.json` when
  storage is available, while retaining runtime-scoped correlation and privacy
  safeguards.
  - @mcp-use/inspector@20.0.0-beta.29

## 2.0.0-beta.36

### Patch Changes

- 1a9b6fb: Correct framework and standalone CLI version reporting, and harden the packaged edge, start, dependency, and clean-install boundaries.
- Updated dependencies [1a9b6fb]
  - @mcp-use/cli@4.0.0-beta.8
  - @mcp-use/inspector@20.0.0-beta.28

## 2.0.0-beta.35

### Patch Changes

- 044962e: Forward the `MANUFACT_CHAT_URL` environment variable to the embedded Inspector. Previously only the standalone `@mcp-use/inspector` CLI read it, so `mcp-use start --with-inspector` (and `mcp-use dev`) served the Inspector without `window.__MANUFACT_CHAT_URL__`, leaving the hosted chat endpoint unconfigured at runtime. Both embedded mounts now pass it through to `mountInspector`, matching the standalone behavior.
  - @mcp-use/inspector@20.0.0-beta.27

## 2.0.0-beta.34

### Minor Changes

- c8c4174: Restore `ctx.sendNotification(method, params?)` for custom notifications related to the active MCP request. The v1-compatible helper now delegates to the official v2 request notification primitive without reintroducing sessions or cross-request state.

### Patch Changes

- @mcp-use/inspector@20.0.0-beta.26

## 2.0.0-beta.33

### Patch Changes

- Updated dependencies [b5151b5]
  - @mcp-use/cli@4.0.0-beta.7
  - @mcp-use/inspector@20.0.0-beta.25

## 2.0.0-beta.32

### Minor Changes

- 23bba3b: Restore the v1-compatible `ctx.client.can()`, `capabilities()`, `info()`, `extension()`, and `user()` helpers using v2 request-scoped metadata. Client capabilities and implementation details come from the modern MCP envelope, while normalized OpenAI caller hints come from ordinary request `_meta`; no metadata is cached across requests or treated as authenticated identity.

### Patch Changes

- @mcp-use/inspector@20.0.0-beta.24

## 2.0.0-beta.31

### Patch Changes

- 95d286e: Replace the transitive `pkg.pr.new` MCP v2 preview dependencies with registry-published SDK beta packages and the temporary npm build of ext-apps PR #720.
  - @mcp-use/inspector@20.0.0-beta.23

## 2.0.0-beta.30

### Minor Changes

- 8259292: Add `mcp-use start --tunnel` for production builds. The command waits for the server to bind, tunnels the actual port, prints the public MCP URL, reuses saved tunnel state, and releases the tunnel during startup failure or graceful shutdown. It composes with `--host` and `--with-inspector` while keeping tunnel code out of ordinary production startup.

### Patch Changes

- Updated dependencies [8259292]
  - @mcp-use/cli@4.0.0-beta.6
  - @mcp-use/inspector@20.0.0-beta.22

## 2.0.0-beta.29

### Minor Changes

- 192d193: Restore Hono as the server HTTP layer. Add typed custom routes and HTTP
  middleware directly on `MCPServer`, expose `server.fetch` as the single
  Web-standard serving boundary, and pass the active Hono context to MCP
  callbacks with `request` plus the deprecated `req` alias.

  Keep v1's `getHandler()` as a deprecated identity alias for `server.fetch`, but
  remove its duplicate lifecycle and configuration path. `getNodeHandler()` is
  not retained: Node's default path uses `server.listen()`, and custom Node
  servers use `toNodeHandler({ fetch: server.fetch })` from `mcp-use/node`.

- 192d193: Require `useCallTool("name")` names to resolve to exported server `ToolRef`
  values once `mcp-env.d.ts` registers the server entry. Add
  `useDynamicTool<Args, Result>("name")` as the explicit escape hatch for tools
  registered from runtime data, loops, or OpenAPI documents.

  Add `mcp-use typecheck`, which refreshes the managed `mcp-env.d.ts` entry
  bridge and then invokes the project's local TypeScript compiler with
  `--noEmit`. New projects scaffold the declaration and use this command in
  their `typecheck` script.

### Patch Changes

- Updated dependencies [192d193]
  - @mcp-use/cli@4.0.0-beta.5
  - @mcp-use/inspector@20.0.0-beta.21

## 2.0.0-beta.28

### Patch Changes

- a4c9c35: Install the Vite and Tailwind build pipeline with the CLI while keeping generated project manifests free of build-tool dependencies.
- Updated dependencies [a4c9c35]
  - @mcp-use/cli@4.0.0-beta.4
  - @mcp-use/inspector@20.0.0-beta.20

## 2.0.0-beta.27

### Patch Changes

- e451e20: Bundle the Vite and Tailwind build pipeline in the CLI so generated projects do not need build-tool dependencies.
- Updated dependencies [e451e20]
  - @mcp-use/cli@4.0.0-beta.3
  - @mcp-use/inspector@20.0.0-beta.19

## 2.0.0-beta.26

### Patch Changes

- c1c6c2b: Publish the optimized standalone Inspector and CLI packaging: ordinary mcp-use installs avoid the Inspector UI dependency graph, while Inspector, client tooling, and production opt-ins remain available on demand.
- Updated dependencies [c1c6c2b]
  - @mcp-use/inspector@20.0.0-beta.18
  - @mcp-use/cli@4.0.0-beta.2

## 2.0.0-beta.25

### Patch Changes

- eedeb4f: Restore complete Inspector relay support for MCP transport and OAuth discovery, registration, and token exchange. Keep confidential dynamic-client secrets in the server-side BFF, recover stale per-server browser OAuth and connection storage safely, isolate callback exchange from background reconnects, and tolerate unsupported optional inventory methods.

  Improve Inspector diagnostics and connection-list behavior with inline error details, a localhost recovery command for hosted callback rejections, newest-first servers, bottom scroll spacing, reliable favicon loading, and versioned revalidated standalone assets.

  Make the Inspector project-pinned local development tooling. Generated projects install `@mcp-use/inspector` as a dev dependency, and `mcp-use dev` dynamically calls its framework-neutral `mountInspector()` on the existing listener. The installed package now owns the only MCP/OAuth proxy and serves its `dist/app` browser bundle locally with no remote application fallback; production handlers no longer expose an Inspector shell or duplicate proxy implementation.

## 2.0.0-beta.24

### Minor Changes

- 786dbf6: Add `mcp-use build --inline` to embed each production view's bundled JavaScript and CSS directly in its MCP resource. External hashed view assets remain the default.

## 2.0.0-beta.23

### Patch Changes

- a3d8591: Make Inspector connection modes authoritative for MCP proxy routing. Auto mode now attempts a direct browser connection before falling back to the configured CORS proxy, Direct mode never uses or falls back to the proxy, and Proxy mode uses it immediately. Clear stale proxy settings when an existing Inspector connection changes modes, keep the server's built-in Inspector on direct origin-level OAuth metadata discovery when no proxy backend is mounted, bypass the browser HTTP cache for OAuth metadata so Origin-specific CORS responses cannot be reused across Inspector origins, make the server-tile Authenticate action clear stored OAuth discovery before starting a fresh flow, and discard authorization-server-generated client secrets from public browser DCR results instead of persisting them.

## 2.0.0-beta.22

### Patch Changes

- 6827ab2: Resolve the current Inspector beta once per page load, then load the entry script, stylesheet, and lazy chunks from the same immutable release. This prevents mixed-version CDN 404s while keeping embedded inspectors on the latest beta.

## 2.0.0-beta.21

### Patch Changes

- 686a5e2: Declare the MCP logging capability so `ctx.sendLog()` can deliver request-scoped log notifications.

## 2.0.0-beta.20

### Minor Changes

- 3aca19c: Prefer Bun over Yarn in the scaffold CLI and docs, and make production source maps opt-in.

  **mcp-use**
  - Add `--source-maps` so `mcp-use build` emits source maps only when requested (server and view bundles default to no maps).
  - Widen `NextConfigLike` with an index signature so `withMcpUse` accepts arbitrary Next.js config fields.

  **create-mcp-use-app**
  - Replace `--yarn` with `--bun`, detect Bun from the user agent, and install/run with Bun when selected.

  **@mcp-use/agent / @mcp-use/client**
  - Point missing-optional-dependency errors at npm, pnpm, or Bun instead of Yarn.

  **@mcp-use/inspector**
  - Drop Yarn-specific install/lint scripts from the package scripts surface.

## 2.0.0-beta.19

### Minor Changes

- 7826695: Ship a Next.js drop-in adapter and harden sandbox view loading in the React client.

  **mcp-use**
  - Add `mcp-use/next` with `withMcpUse` and `createNextHandler` so MCP servers can mount inside Next.js App Router projects.
  - Teach `mcp-use dev` / `mcp-use build` to discover `--mcp-dir` / `--views-dir`, load Next-style `.env*` files, and shim Next server-only modules when building standalone from a Next host.
  - Add Next.js drop-in and standalone examples plus CI verification for the example suite.

  **@mcp-use/client**
  - Load blob sandboxes via `iframe.srcdoc` and delay blob URL revocation so React StrictMode remounts do not break view rendering.

## 2.0.0-beta.18

### Patch Changes

- c878835: Fix duplicated public assets in production builds and remove Scarf telemetry.

  **mcp-use**
  - Set `publicDir: false` on all Vite build steps so project `public/` is copied only to `.mcp-use/build/views/public/` (not duplicated at the build root or inside each view outDir).
  - Raise the view client build `chunkSizeWarningLimit` to reduce noisy warnings for large view bundles.

  **@mcp-use/client**
  - Remove Scarf download telemetry (`captureScarf`, beacon helpers, and related storage); PostHog remains the sole telemetry provider.

  **@mcp-use/inspector**
  - Drop inspector package-download Scarf tracking on init; update README and e2e docs to reflect PostHog-only telemetry.

## 2.0.0-beta.17

### Patch Changes

- fe4d3b2: Enable MCP view JS code splitting and polish inspector boot UX.

  **mcp-use**
  - Enable rolldown code splitting for per-view client builds (`chunkFileNames` alongside the entry chunk); update `VIEWS_SPEC.md` for external assets and split chunks.
  - Paint a centered boot spinner in the managed inspector shell while the CDN bundle downloads.

  **@mcp-use/inspector**
  - Match the boot spinner placeholder in the CDN inspector shell.
  - Add top margin to tool error banners in the result panel.

  **create-mcp-use-app**
  - Fix scaffold README inspector links to `${basePath}/inspector` (`/mcp/inspector` by default).
  - Align the mcp-apps `mcp-env.d.ts` template comment with the auto-generated shim.

## 2.0.0-beta.16

### Patch Changes

- 2ee60d0: Fix `mcp-use dev` port auto-find and Vite env deprecation warning.
  - Replace deprecated Vite `envFile: false` with `envDir: false` in dev/build/view CLI paths.
  - On localhost-class binds, treat a port as taken when loopback (`127.0.0.1` or `::1`) already accepts connections — restores CLI v1 behavior when another process owns `*:port` (e.g. Next.js on macOS dual-stack).

## 2.0.0-beta.15

### Patch Changes

- d9c2023: Skip `dev/info` tunnel probes unless `mcp-use dev` injects `window.__MCP_DEV_CLI__`.

  **@mcp-use/inspector**
  - Gate tunnel metadata probes on `window.__MCP_DEV_CLI__ === true` instead of treating a missing `__MCP_INSPECTOR_MODE__` as non-standalone.

  **mcp-use**
  - Set `MCP_USE_DEV_CLI` in the dev CLI and inject `window.__MCP_DEV_CLI__ = true` into the inspector CDN shell so embedded dev sessions still sync tunnel state.

## 2.0.0-beta.14

### Minor Changes

- 6aa0857: Make MCP operation middleware type-safe by method. Exact patterns now correlate request params, `next()`, and return values; list middleware receives typed `Tool[]`, `Resource[]`, or `Prompt[]` arrays; and global `mcp:*` middleware preserves downstream results without exposing a cross-method replacement escape hatch. Category wildcards remain available for observer events. Observer events gain the same method-specific context and completion result types. Low-level typed entry adapters are available from the package root for advanced composition.

## 2.0.0-beta.13

### Minor Changes

- f259641: Align view authoring layout, typing shims, and local dev host behavior across the v2 stack.

  **mcp-use**
  - Move file-based view sources from `resources/` to `views/` (wire exposure stays MCP resources).
  - Replace root `tools.d.ts` with `mcp-env.d.ts`, adding CSS module typing plus the live `Register` import shim; dev/build create it exclusively when absent.
  - Simplify favicon selection to the first icon (or explicit `favicon` config).
  - Auto-respawn the dev tunnel on disconnect with exponential backoff and subdomain fallback.

  **@mcp-use/client**
  - Add `mockOpenAiFileApis` on `ViewRenderer` and export `injectOpenAiFileApis` so `useFiles()` works in inspector and other local hosts.
  - Advertise host `message` capability by default.

  **@mcp-use/inspector**
  - Enable `mockOpenAiFileApis` in view preview and standalone host props.

  **create-mcp-use-app**
  - Refresh starter, blank, and MCP Apps scaffolds for `views/`, `mcp-env.d.ts`, webp demo assets, and the expanded product-search carousel template.

## 2.0.0-beta.12

### Patch Changes

- 4810321: Fix `mcp-use client` UX after auto-installing `@mcp-use/client`: the connect command now continues in the same run by importing the client SDK from the project install location instead of the npx cache. OAuth connect prompts before opening a browser in a TTY (`--open` / `--no-open` override). `mcp-use client --help` prints client-specific usage instead of the top-level command list.
- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- 50df3a1: Refresh scaffold and example dependency pins: TypeScript `^7.0.2` (stable, replaces `7.0.1-rc`) and React `^19.2.7`.

## 2.0.0-beta.11

### Minor Changes

- 20d8f85: Auto-install `@mcp-use/client` when `mcp-use client` or `mcp-use screenshot` needs it and the package is missing. Installs into the nearest project when a `package.json` exists; otherwise uses a global sandbox at `~/.mcp-use/client-sdk/`. Fixes `npx mcp-use client connect …` without a separate client install step.

## 2.0.0-beta.10

### Minor Changes

- adebe07: Add `MCPServer.proxy()` for composing multiple upstream MCP servers through the
  optional `@mcp-use/client` v2 peer. HTTP upstreams are automatically namespaced
  and registered best-effort, authenticated connections use caller-managed bearer
  tokens or headers without browser OAuth, and ready `MCPConnection` instances can
  also be mounted with their negotiated server name as the namespace.

## 2.0.0-beta.9

### Minor Changes

- fa57403: Add v2 server branding with official MCP `icons` and `websiteUrl` identity metadata, automatic favicon selection, and fetch-native local, data URL, and remote favicon handling.

## 2.0.0-beta.8

### Minor Changes

- 4054510: Add typed static and callback completion providers for resource-template URI variables.

## 2.0.0-beta.7

### Minor Changes

- eabae55: Add the v2 `oauthBetterAuthProvider({ authURL })` resource-server adapter and a
  credential-free Hono example using Better Auth anonymous sign-in with stateless
  cookie sessions.

## 2.0.0-beta.6

### Minor Changes

- 6737ecc: Add MCP operation middleware, observer events, optional CORS, and universal handler mounting on the fetch-native v2 server.
  - **`server.use('mcp:…')`** — intercept tool/resource/prompt calls and list operations with a `next()` chain; typed `ctx.params` for `tools/call`, `resources/read`, and `prompts/get`
  - **`server.on('mcp:…')` / `server.on('mcp:…:complete')`** — read-only observers for logging and metrics (throws do not fail the request)
  - **`ServerConfig.cors`** — optional CORS on MCP-owned routes (`getHandler()` / `listen()`); pair with `allowedOrigins` for browser clients
  - **`getHandler()`** — universal web handler (raw `Request` or Hono-style `{ req: { raw } }`); **`getNodeHandler()`** — internal Node `(req, res)` bridge for custom `http.Server` composition
  - Export middleware helpers and types (`composeMiddleware`, `matchesPattern`, `MiddlewareContext`, `FrameworkHandler`, `CorsOptions`, …)

## 2.0.0-beta.5

### Minor Changes

- 14ae280: Add a `useFiles()` React hook with the familiar v1 upload/download shape for ChatGPT file uploads and temporary download URLs. The isolated files channel feature-detects only the optional `window.openai.uploadFile` and `window.openai.getFileDownloadUrl` extensions and does not read or mutate widget state.

## 2.0.0-beta.4

### Minor Changes

- 4f11e03: Revamp the production view build pipeline and deployment env surface.
  - **`mcp-use build`** emits hashed view assets on disk (`kind: "external"`) instead of inlining JS/CSS into the manifest; production serves bundles from `${basePath}/_mcp-use/views/<name>/`.
  - Add **`--with-inspector`** so the build manifest records inspector availability for `mcp-use start` (no longer always `true`).
  - Support **`MCP_ASSETS_URL`** at build time (rewrite manifest asset paths to CDN URLs) and runtime (resolve view `publicBase` and asset hrefs separately from **`MCP_URL`** server origin).
  - Add global CSP env: **`CSP_URLS`** (all four MCP Apps categories) and **`CSP_*_DOMAINS`** per-category overrides, merged with author `view.csp` before MCP auto-append.
  - Bundle **`@modelcontextprotocol/client`** as a runtime dependency for the CLI.

## 2.0.0-beta.2

### Patch Changes

- 69d5da9: Load the default Inspector UI from the npm `beta` dist-tag so Inspector beta fixes reach mcp-use beta users without waiting for another SDK release.

## 2.0.0-beta.1

### Minor Changes

- 389c7b8: Add `MCPServer.fromOpenAPI` to the v2 server, generating validated MCP tools and upstream HTTP request handlers from bundled OpenAPI documents, with a runnable National Weather Service example.

## 2.0.0-beta.0

### Major Changes

- a9ba017: Migrate the client stack to the official MCP TypeScript SDK v2 (`@modelcontextprotocol/client@2.0.0-beta.2`).
  - `@mcp-use/client` now depends on `@modelcontextprotocol/client` instead of `@modelcontextprotocol/sdk`, and is ESM-only (Node 20+). All connectors, sessions, OAuth, and the React `useMcp` hook were ported to the v2 API surface (method-string handlers, `SdkHttpError`/`SdkError`, `OAuthError`, `Headers`, `client/stdio` subpath).
  - Automatic protocol negotiation: HTTP connections default to `versionNegotiation: "auto"` (probe with `server/discover`, transparently falling back to the 2025 `initialize` handshake against v1 servers); stdio defaults to the SDK's v1 mode. The negotiated generation/version is exposed on the connection and `useMcp` result as `protocolEra: "legacy" | "modern"` and `protocolVersion`.
  - OAuth: consolidated `OAuthError`, issuer-stamp round-tripping, `discoveryState()` / `saveDiscoveryState()`, and `iss` validation on the callback (SEP-2352 / RFC 9207).
  - The root `@mcp-use/client` export now selects a browser-safe HTTP implementation outside Node and a Node-enabled implementation under Node. `@mcp-use/client/browser`, `@mcp-use/client/auth`, and `@mcp-use/client/auth/node` were removed; use the root `MCPClient`, `createOAuthProvider`, and React entry instead.
  - Breaking: the Node root entry no longer re-exports `BrowserOAuthClientProvider`, `BrowserOAuthOptions`, or `onMcpAuthorization` (those pull browser/`localStorage` code into the Node graph). Import them from `@mcp-use/client` in a browser bundler (default export condition) or from `@mcp-use/client/react` for the callback helper.
  - `MCPClient.connect()` / `createSession()` auto-provisions OAuth for HTTP servers (via the entry’s `createOAuthProvider`) when no bearer/`authProvider` is set, completes the 401 → consent dance, and retries. Pass `oauth` options or `oauth: false` on the server config; `authProvider` remains an escape hatch. The CLI connect path uses this instead of hand-wiring `NodeOAuthClientProvider`.
  - Breaking: removed v1 aliases (`samplingCallback`, `elicitationCallback`, `auth_token`, `customHeaders`, `clientConfig`, `debug`, `BrowserTelemetry`, and `ResourceTemplate`). Use `onSampling`, `onElicitation`, `authToken`, `headers`, `clientInfo`, `logLevel`, `Telemetry`, and `ResourceTemplateType`.
  - Dependency slimming: removed `posthog-js` / `posthog-node` in favor of a `fetch`-only PostHog capture (no SDK), and dropped `@modelcontextprotocol/ext-apps` (a single MIME-type constant was inlined). `@mcp-use/client` now has a single runtime dependency (`@modelcontextprotocol/client`).
  - The v2 packages use commit-pinned MCP SDK preview builds required by this beta; `@mcp-use/agent` no longer carries the unused v1 `@modelcontextprotocol/sdk`.
  - Runtime verification now covers Node, Deno, browser, and React against real v1 and v2 servers. Browser fetch is explicitly bound, Deno logging does not require env permission, and `useMcp` reaches `ready` only after normalized metadata is populated.
  - Client examples now run against a four-server matrix (official SDK stateful v1/stateless v2 plus mcp-use v1/v2 servers with MCP Apps) and cover notifications, roots, sampling, elicitation, completion, capability negotiation, OAuth, and rendered widgets. HTTP/stdio config now forwards initial roots, SDK client options, default request options, and HTTP connection timeouts to connectors.
  - Fixed legacy Streamable HTTP reverse RPC and notifications: streaming responses are no longer consumed by request logging, and sampling/elicitation use the active request transport. The v2 client auto-opens list-change subscriptions and preserves progress across MRTR retry rounds.
  - `McpClientProvider` now propagates negotiated v1/v2 metadata, auth state, resource templates, and reverse-request queues consistently. Its configured display label is now `displayName`; `name` remains the negotiated server identity.
  - React connections are HTTP-only, reconnect automatically, suppress console logging, and wait for explicit OAuth authentication by default. `clientOptions.capabilities.views: true` advertises MCP Apps support without hand-writing extension capabilities.
  - OAuth and transport proxies now preserve the upstream MCP URL as the SDK resource identity. Removed metadata/resource rewrite shims and gateway-derived OAuth URLs; MCP and OAuth bytes use separate injected fetch adapters.
  - Browser OAuth supports CIMD through `clientMetadataUrl`, keeps DCR as SDK-managed compatibility fallback, stores credentials per authorization-server issuer, and rejects browser client secrets.
  - The Inspector OAuth BFF now binds requests to SDK-discovered metadata/endpoints, fails closed on SSRF/private targets and redirects, caps bodies/timeouts, strips unsafe headers, and restricts CORS origins.
  - Breaking: `@mcp-use/client` is ESM-only and no longer re-exports Zod `*Schema` constants (use `isSpecType` / `specTypeSchemas`). The exported `telFetch` is now a plain non-throwing `fetch` wrapper `(url, init) => Promise<void>` (previously a PostHog `fetch` override). Removed the vendored `JSONSchemaToZod` helper — use Zod 4's native `z.fromJSONSchema()` instead.
  - The inspector and CLI were updated to consume the v2 client; the CLI gains a `--negotiate` flag on `client connect`. The CLI binary is now ESM (`dist/index.js`) since `@mcp-use/client` is ESM-only (`npx mcp-use` is unaffected).
  - Internal `@mcp-use/client` src layout reorganized into semantic folders (`transport/`, flat root client API, `code-mode/`, slim `auth/`, collapsed `react/`); public package exports (`.` and `./react`) and symbol names are unchanged.

### Patch Changes

- b4c192e: Enable localhost managed inspector chat via browser MCPAgent and the cloud LLM proxy. Anonymous users must sign in; authenticated usage draws from Autumn `llm_tokens` credits.
- 0d9dd27: Strip draft-07 `$schema` from tool `inputSchema` and `outputSchema` in `tools/list` responses. The v1 SDK stamps `http://json-schema.org/draft-07/schema#`, which v2 MCP clients reject when compiling output schemas; omitting `$schema` is accepted by both v1 and v2 clients (issue #1839).
