# @mcp-use/client

## 2.2.4

### Patch Changes

- 5e7e350: Rebind the OAuth loopback listener after a failed bind. `startLoopback()` assigned `this.server` before `listen()` resolved, so a bind failure left a server that was never listening; the `if (this.server) return` guard then made every later authorization skip binding and hang until the auth timeout.

## 2.2.4-canary.0

### Patch Changes

- b951f1f: Rebind the OAuth loopback listener after a failed bind. `startLoopback()` assigned `this.server` before `listen()` resolved, so a bind failure left a server that was never listening; the `if (this.server) return` guard then made every later authorization skip binding and hang until the auth timeout.

## 2.2.3

### Patch Changes

- 32da345: Stop OAuth authorization retries after the client disconnects.
- 32da345: Fix `listAllResources` throwing a raw `TypeError` when a disconnect lands between pages. The pagination loop read `this.client` once per page, so `disconnect()` clearing it mid-listing surfaced `Cannot read properties of null (reading 'listResources')` instead of the transport's own error.

## 2.2.3-canary.1

### Patch Changes

- 676902b: Fix `listAllResources` throwing a raw `TypeError` when a disconnect lands between pages. The pagination loop read `this.client` once per page, so `disconnect()` clearing it mid-listing surfaced `Cannot read properties of null (reading 'listResources')` instead of the transport's own error.

## 2.2.3-canary.0

### Patch Changes

- 0eca6f2: Stop OAuth authorization retries after the client disconnects.

## 2.2.2

### Patch Changes

- 82772dc: Ensure `useMcp` exposes OAuth tokens in the same render that marks an authenticated connection as ready.

## 2.2.2-canary.0

### Patch Changes

- fed8d64: Ensure `useMcp` exposes OAuth tokens in the same render that marks an authenticated connection as ready.

## 2.2.1

### Patch Changes

- f2f4fdb: Disconnect the session that `MCPClient.createSession()` replaces. Recreating a session for a server that already had one overwrote the session slot without disconnecting the old connector, so its stdio child process (or HTTP session) stayed alive and was no longer reachable from `closeSession()`/`closeAllSessions()`.

## 2.2.1-canary.0

### Patch Changes

- 45dd7f2: Disconnect the session that `MCPClient.createSession()` replaces. Recreating a session for a server that already had one overwrote the session slot without disconnecting the old connector, so its stdio child process (or HTTP session) stayed alive and was no longer reachable from `closeSession()`/`closeAllSessions()`.

## 2.2.0

### Minor Changes

- 1af9beb: Support passing MCP `RequestOptions` through prompt reads.

## 2.2.0-canary.0

### Minor Changes

- 3461646: Support passing MCP `RequestOptions` through prompt reads.

## 2.1.5

### Patch Changes

- bdd8ec8: fix the OpenAI compatibility shim to return a promise from `setWidgetState`, preserving the v1 `useWidget()` contract while keeping native v2 MCP Apps behavior unchanged.

## 2.1.5-canary.0

### Patch Changes

- bdd8ec8: fix the OpenAI compatibility shim to return a promise from `setWidgetState`, preserving the v1 `useWidget()` contract while keeping native v2 MCP Apps behavior unchanged.

## 2.1.4

### Patch Changes

- 6343150: Refresh persisted browser OAuth discovery whenever an MCP server sends a new protected-resource metadata challenge, including when the metadata URL is unchanged.
- c9c944b: Recover browser OAuth discovery when a fresh MCP `resource_metadata` challenge conflicts with incomplete or stale persisted discovery state.

## 2.1.4-canary.1

### Patch Changes

- 6343150: Refresh persisted browser OAuth discovery whenever an MCP server sends a new protected-resource metadata challenge, including when the metadata URL is unchanged.

## 2.1.4-canary.0

### Patch Changes

- c9c944b: Recover browser OAuth discovery when a fresh MCP `resource_metadata` challenge conflicts with incomplete or stale persisted discovery state.

## 2.1.3

### Patch Changes

- aba4346: Stop blocking legacy HTTP connection readiness for up to five seconds while the optional standalone SSE stream attaches. Notification and reverse-RPC handlers are now registered before the handshake so request/response operations can proceed immediately without racing inbound messages.
- aba4346: Defer Node OAuth store creation and callback port persistence until an authorization flow actually begins.

## 2.1.3-canary.1

### Patch Changes

- 0e65b00: Stop blocking legacy HTTP connection readiness for up to five seconds while the optional standalone SSE stream attaches. Notification and reverse-RPC handlers are now registered before the handshake so request/response operations can proceed immediately without racing inbound messages.

## 2.1.3-canary.0

### Patch Changes

- 77ceb91: Defer Node OAuth store creation and callback port persistence until an authorization flow actually begins.

## 2.1.2

### Patch Changes

- 4104309: Replay MCP App invocation state when a Vite or React development runtime initializes a replacement guest App inside the existing iframe.

## 2.1.2-canary.0

### Patch Changes

- f18ba62: Replay MCP App invocation state when a Vite or React development runtime initializes a replacement guest App inside the existing iframe.

## 2.1.1

### Patch Changes

- e17cd7b: Enable the Inspector Skills tab when a dev-server HMR reload adds skills after
  the initial connection negotiated without the Skills extension.
- e17cd7b: Detect mixed-auth MCP servers without blocking anonymous connections, expose optional authentication in React, the CLI, and the Inspector, resume protected operations through the official SDK OAuth flow, and preserve multiple Set-Cookie headers through the Node bridge for colocated OAuth servers.
- e17cd7b: Surface mixed-auth state when protected resource, prompt, skill, completion, or refresh operations require OAuth, so React clients retain their ready anonymous connection and can present authentication for every challenged operation.
- e17cd7b: Disable reverse-proxy buffering for open-ended MCP SSE responses so v2 subscription acknowledgements reach clients immediately, and move optional mixed-auth discovery off the connection readiness path while preserving asynchronous React updates and CLI reporting.
- e17cd7b: Recover mixed-auth metadata discovery after transient failures, preserve ready React connections when optional token projection fails, report authenticated state after challenged OAuth, correct CLI login recovery, suppress failure results for user-cancelled Inspector tools, and keep the mixed-OAuth example's authorization guard aligned with MCP JSON parsing.
- e17cd7b: Fix code mode with a custom executor function: the first `executeCode()` call no longer throws `Custom executor function should be handled in executeCode`, `searchTools()` works instead of always throwing, and `close()` runs executor cleanup. Also forward `detail_level` from the `search_tools` meta tool instead of silently coercing every value to `"full"`.

## 2.1.1-canary.4

### Patch Changes

- b4caaa3: Surface mixed-auth state when protected resource, prompt, skill, completion, or refresh operations require OAuth, so React clients retain their ready anonymous connection and can present authentication for every challenged operation.

## 2.1.1-canary.3

### Patch Changes

- e7ca969: Enable the Inspector Skills tab when a dev-server HMR reload adds skills after
  the initial connection negotiated without the Skills extension.

## 2.1.1-canary.2

### Patch Changes

- 6c310bf: Fix code mode with a custom executor function: the first `executeCode()` call no longer throws `Custom executor function should be handled in executeCode`, `searchTools()` works instead of always throwing, and `close()` runs executor cleanup. Also forward `detail_level` from the `search_tools` meta tool instead of silently coercing every value to `"full"`.

## 2.1.1-canary.1

### Patch Changes

- c5262c9: Disable reverse-proxy buffering for open-ended MCP SSE responses so v2 subscription acknowledgements reach clients immediately, and move optional mixed-auth discovery off the connection readiness path while preserving asynchronous React updates and CLI reporting.

## 2.1.1-canary.0

### Patch Changes

- 1c3e40b: Detect mixed-auth MCP servers without blocking anonymous connections, expose optional authentication in React, the CLI, and the Inspector, resume protected operations through the official SDK OAuth flow, and preserve multiple Set-Cookie headers through the Node bridge for colocated OAuth servers.

## 2.1.0

### Minor Changes

- 2daf9c9: Add typed Skills over MCP client operations, a capability-gated Inspector
  file explorer with integrity verification, and removable progressive skill
  context in Inspector chat.

### Patch Changes

- 60eb3ac: Populate the Inspector's `window.openai` compatibility bridge with tool lifecycle globals and host actions while preserving the native MCP Apps handshake for V2 views.
- 792e8eb: Allow widget-declared MCP App sandbox CSPs to use dynamic compilation while preserving their declared domain restrictions.
- 52f535c: Allow modern MCP connections to remain ready when the server omits optional identity metadata. Direct proxy connections now report a clear error when an anonymous upstream cannot provide a namespace.
- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

## 2.1.0-canary.5

### Minor Changes

- 2daf9c9: Add typed Skills over MCP client operations, a capability-gated Inspector
  file explorer with integrity verification, and removable progressive skill
  context in Inspector chat.

### Patch Changes

- 60eb3ac: Populate the Inspector's `window.openai` compatibility bridge with tool lifecycle globals and host actions while preserving the native MCP Apps handshake for V2 views.
- 792e8eb: Allow widget-declared MCP App sandbox CSPs to use dynamic compilation while preserving their declared domain restrictions.
- 819ef5b: Prevent iframe console log records from being parsed as MCP Apps JSON-RPC messages in the Inspector.
- 52f535c: Allow modern MCP connections to remain ready when the server omits optional identity metadata. Direct proxy connections now report a clear error when an anonymous upstream cannot provide a namespace.
- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

## 2.1.0-canary.4

### Patch Changes

- 792e8eb: Allow widget-declared MCP App sandbox CSPs to use dynamic compilation while preserving their declared domain restrictions.

## 2.1.0-canary.3

### Minor Changes

- 2daf9c9: Add typed Skills over MCP client operations, a capability-gated Inspector
  file explorer with integrity verification, and removable progressive skill
  context in Inspector chat.

### Patch Changes

- 819ef5b: Prevent iframe console log records from being parsed as MCP Apps JSON-RPC messages in the Inspector.

## 2.0.2-canary.2

### Patch Changes

- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

## 2.0.2-canary.1

### Patch Changes

- 60eb3ac: Populate the Inspector's `window.openai` compatibility bridge with tool lifecycle globals and host actions while preserving the native MCP Apps handshake for V2 views.

## 2.0.2-canary.0

### Patch Changes

- 52f535c: Allow modern MCP connections to remain ready when the server omits optional identity metadata. Direct proxy connections now report a clear error when an anonymous upstream cannot provide a namespace.

## 2.0.1

### Patch Changes

- 33e30cb: Make the stdio `errlog` option work, and expose `stderr` as a supported mode.

  The transport was spawned without `stderr: "pipe"`, so the SDK defaulted to `"inherit"`, `transport.stderr` was null, and the block that forwards the child's stderr to `errlog` never ran. `errlog` now receives the child's stderr by default:

  ```ts
  new StdioConnector({ command, args, errlog });
  ```

  `stderr` is accepted on `StdioConnector` and `StdioServerConfig` and forwarded to the transport, so the previous behaviour is still available explicitly:

  ```ts
  new StdioConnector({ command, args, stderr: "inherit" });
  ```

  **Behaviour change:** stdio children previously inherited the parent's stderr file descriptor and now get a pipe by default. Output still reaches `process.stderr` when no `errlog` is given, but a child that checks whether stderr is a TTY will no longer see one, which can disable its colorized output. Pass `stderr: "inherit"` to restore that, or `"ignore"` to discard child stderr entirely.

  Forwarding also pipes with `{ end: false }` and unpipes on close, so a caller-owned `errlog` is not closed when a child exits and can be reused across reconnects or several connectors.

- 33e30cb: Stop leaking the full parent process environment to stdio MCP servers when explicit environment variables are configured.

## 2.0.1-canary.1

### Patch Changes

- f5a765f: Make the stdio `errlog` option work, and expose `stderr` as a supported mode.

  The transport was spawned without `stderr: "pipe"`, so the SDK defaulted to `"inherit"`, `transport.stderr` was null, and the block that forwards the child's stderr to `errlog` never ran. `errlog` now receives the child's stderr by default:

  ```ts
  new StdioConnector({ command, args, errlog });
  ```

  `stderr` is accepted on `StdioConnector` and `StdioServerConfig` and forwarded to the transport, so the previous behaviour is still available explicitly:

  ```ts
  new StdioConnector({ command, args, stderr: "inherit" });
  ```

  **Behaviour change:** stdio children previously inherited the parent's stderr file descriptor and now get a pipe by default. Output still reaches `process.stderr` when no `errlog` is given, but a child that checks whether stderr is a TTY will no longer see one, which can disable its colorized output. Pass `stderr: "inherit"` to restore that, or `"ignore"` to discard child stderr entirely.

  Forwarding also pipes with `{ end: false }` and unpipes on close, so a caller-owned `errlog` is not closed when a child exits and can be reused across reconnects or several connectors.

## 2.0.1-canary.0

### Patch Changes

- 4ea75fd: Stop leaking the full parent process environment to stdio MCP servers when explicit environment variables are configured.

## 2.0.0

### Major Changes

- a9ba017: Migrate the client stack to the official MCP TypeScript SDK v2 (`@modelcontextprotocol/client@2.0.0-beta.2`).
  - `@mcp-use/client` now depends on `@modelcontextprotocol/client` instead of `@modelcontextprotocol/sdk`. Both `@mcp-use/client` and `@mcp-use/agent` are ESM-only (Node 22.22.2+); CommonJS `require()` entry points and builds are no longer published. All connectors, sessions, OAuth, and the React `useMcp` hook were ported to the v2 API surface (method-string handlers, `SdkHttpError`/`SdkError`, `OAuthError`, `Headers`, `client/stdio` subpath).
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
  - Breaking: `@mcp-use/client` and `@mcp-use/agent` are ESM-only. Use ESM `import` or dynamic `import()` from a CommonJS host; direct `require()` is unsupported. The client no longer re-exports Zod `*Schema` constants (use `isSpecType` / `specTypeSchemas`). The exported `telFetch` is now a plain non-throwing `fetch` wrapper `(url, init) => Promise<void>` (previously a PostHog `fetch` override). Removed the vendored `JSONSchemaToZod` helper — use Zod 4's native `z.fromJSONSchema()` instead.
  - The inspector and CLI were updated to consume the v2 client; the CLI gains a `--negotiate` flag on `client connect`. The CLI binary is now ESM (`dist/index.js`) since `@mcp-use/client` is ESM-only (`npx mcp-use` is unaffected).
  - Internal `@mcp-use/client` src layout reorganized into semantic folders (`transport/`, flat root client API, `code-mode/`, slim `auth/`, collapsed `react/`); public package exports (`.` and `./react`) and symbol names are unchanged.

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

### Patch Changes

- c878835: Fix duplicated public assets in production builds and remove Scarf telemetry.

  **mcp-use**
  - Set `publicDir: false` on all Vite build steps so project `public/` is copied only to `.mcp-use/build/views/public/` (not duplicated at the build root or inside each view outDir).
  - Raise the view client build `chunkSizeWarningLimit` to reduce noisy warnings for large view bundles.

  **@mcp-use/client**
  - Remove Scarf download telemetry (`captureScarf`, beacon helpers, and related storage); PostHog remains the sole telemetry provider.

  **@mcp-use/inspector**
  - Drop inspector package-download Scarf tracking on init; update README and e2e docs to reflect PostHog-only telemetry.

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

- 24d2024: Make MCP Apps Chat messages await delivery, scope widget model context to the active Chat surface, and keep app-only tools out of model tool registries.
- ac3d1eb: Harden browser launching, Inspector routes, and browser persistence. OAuth
  session values are encrypted at rest, secret connection fields are no longer
  persisted, Inspector assets and proxy/OAuth APIs are rate-limited, and CLI
  browser opening now validates HTTP(S) targets and uses shell-free launchers.
- 0d9dd27: Default `jsonSchemaValidator` (`DialectJsonSchemaValidator`) now accepts JSON Schema draft-04/-07/2019-09 dialects emitted by v1-era servers, fixing `InvalidParams` on `callTool` for tools with `outputSchema` (issue #1839).
- bef150a: Expose the OAuth protected-resource URL with React auth tokens for consumers that perform server-side token refresh.
- f3fc8da: Surface manual browser OAuth failures immediately instead of treating them as popup handoffs.
- eedeb4f: Restore complete Inspector relay support for MCP transport and OAuth discovery, registration, and token exchange. Keep confidential dynamic-client secrets in the server-side BFF, recover stale per-server browser OAuth and connection storage safely, isolate callback exchange from background reconnects, and tolerate unsupported optional inventory methods.

  Improve Inspector diagnostics and connection-list behavior with inline error details, a localhost recovery command for hosted callback rejections, newest-first servers, bottom scroll spacing, reliable favicon loading, and versioned revalidated standalone assets.

  Make the Inspector project-pinned local development tooling. Generated projects install `@mcp-use/inspector` as a dev dependency, and `mcp-use dev` dynamically calls its framework-neutral `mountInspector()` on the existing listener. The installed package now owns the only MCP/OAuth proxy and serves its `dist/app` browser bundle locally with no remote application fallback; production handlers no longer expose an Inspector shell or duplicate proxy implementation.

- a3d8591: Make Inspector connection modes authoritative for MCP proxy routing. Auto mode now attempts a direct browser connection before falling back to the configured CORS proxy, Direct mode never uses or falls back to the proxy, and Proxy mode uses it immediately. Clear stale proxy settings when an existing Inspector connection changes modes, keep the server's built-in Inspector on direct origin-level OAuth metadata discovery when no proxy backend is mounted, bypass the browser HTTP cache for OAuth metadata so Origin-specific CORS responses cannot be reused across Inspector origins, make the server-tile Authenticate action clear stored OAuth discovery before starting a fresh flow, and discard authorization-server-generated client secrets from public browser DCR results instead of persisting them.
- c7accd6: Fix standalone Inspector OAuth and CDN delivery.

  **@mcp-use/inspector**
  - Serve the built UI from `dist/cdn/` locally in standalone mode (`pnpm start` / `npx`); embedded mounts still default to jsDelivr `@beta`.
  - Point `pnpm start` at `dist/cli.js` so standalone runs the full proxy + OAuth BFF shell.
  - Skip `dev/info` tunnel probes in standalone mode (route exists only under `mcp-use dev`).
  - Simplify e2e matrix: builtin/prod modes rely on in-process static assets instead of a separate CDN fixture server.
  - Document jsDelivr-first embedding vs local standalone in `docs/inspector/integration.mdx`.

  **@mcp-use/client**
  - Fix Linear (and other OAuth) redirect flows: do not auto-connect saved MCP servers on `/oauth/callback`, which overwrote the PKCE verifier before token exchange.
  - Stop HEAD health-check polling after a 405/404 from servers that only accept POST (reduces console noise for providers like Linear).

- 7826695: Ship a Next.js drop-in adapter and harden sandbox view loading in the React client.

  **mcp-use**
  - Add `mcp-use/next` with `withMcpUse` and `createNextHandler` so MCP servers can mount inside Next.js App Router projects.
  - Teach `mcp-use dev` / `mcp-use build` to discover `--mcp-dir` / `--views-dir`, load Next-style `.env*` files, and shim Next server-only modules when building standalone from a Next host.
  - Add Next.js drop-in and standalone examples plus CI verification for the example suite.

  **@mcp-use/client**
  - Load blob sandboxes via `iframe.srcdoc` and delay blob URL revocation so React StrictMode remounts do not break view rendering.

- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- 95d286e: Replace the transitive `pkg.pr.new` MCP v2 preview dependencies with registry-published SDK beta packages and the temporary npm build of ext-apps PR #720.
- f3ec4c5: Update the official MCP split SDK dependencies and the temporary ext-apps PR #720 build to stable 2.0.0 releases.
- da86879: Keep MCP Apps widgets mounted while Chat state changes, deliver complete tool lifecycle notifications, isolate sandbox origins, and support host-confirmed sampling, downloads, context updates, and app-provided tools.
- 3294086: Stream partial tool-call arguments into the Inspector drawer and MCP App view while the model is generating them. Anthropic tool requests now opt into eager input streaming, partial JSON healing handles code and SVG strings correctly, hosted chat accepts tool-call start/delta frames, and the view host no longer overwrites newer partial input with a stale complete-input notification.
- be2dd8e: Expose the dependency-free sandbox document builder as a focused client
  subpath and bundle it into the Inspector's Node entry so the zero-dependency
  Inspector package loads in clean installations.
- a6ec149: Fix code-mode shim generation for server and tool names containing quotes or other special characters.

## 2.0.0-beta.18

### Patch Changes

- a6ec149: Fix code-mode shim generation for server and tool names containing quotes or other special characters.

## 2.0.0-beta.17

### Patch Changes

- f3ec4c5: Update the official MCP split SDK dependencies and the temporary ext-apps PR #720 build to stable 2.0.0 releases.

## 2.0.0-beta.16

### Patch Changes

- be2dd8e: Expose the dependency-free sandbox document builder as a focused client
  subpath and bundle it into the Inspector's Node entry so the zero-dependency
  Inspector package loads in clean installations.

## 2.0.0-beta.15

### Patch Changes

- da86879: Keep MCP Apps widgets mounted while Chat state changes, deliver complete tool lifecycle notifications, isolate sandbox origins, and support host-confirmed sampling, downloads, context updates, and app-provided tools.

## 2.0.0-beta.14

### Patch Changes

- 24d2024: Make MCP Apps Chat messages await delivery, scope widget model context to the active Chat surface, and keep app-only tools out of model tool registries.

## 2.0.0-beta.13

### Patch Changes

- ac3d1eb: Harden browser launching, Inspector routes, and browser persistence. OAuth
  session values are encrypted at rest, secret connection fields are no longer
  persisted, Inspector assets and proxy/OAuth APIs are rate-limited, and CLI
  browser opening now validates HTTP(S) targets and uses shell-free launchers.

## 2.0.0-beta.12

### Patch Changes

- 95d286e: Replace the transitive `pkg.pr.new` MCP v2 preview dependencies with registry-published SDK beta packages and the temporary npm build of ext-apps PR #720.

## 2.0.0-beta.11

### Patch Changes

- eedeb4f: Restore complete Inspector relay support for MCP transport and OAuth discovery, registration, and token exchange. Keep confidential dynamic-client secrets in the server-side BFF, recover stale per-server browser OAuth and connection storage safely, isolate callback exchange from background reconnects, and tolerate unsupported optional inventory methods.

  Improve Inspector diagnostics and connection-list behavior with inline error details, a localhost recovery command for hosted callback rejections, newest-first servers, bottom scroll spacing, reliable favicon loading, and versioned revalidated standalone assets.

  Make the Inspector project-pinned local development tooling. Generated projects install `@mcp-use/inspector` as a dev dependency, and `mcp-use dev` dynamically calls its framework-neutral `mountInspector()` on the existing listener. The installed package now owns the only MCP/OAuth proxy and serves its `dist/app` browser bundle locally with no remote application fallback; production handlers no longer expose an Inspector shell or duplicate proxy implementation.

## 2.0.0-beta.10

### Patch Changes

- a3d8591: Make Inspector connection modes authoritative for MCP proxy routing. Auto mode now attempts a direct browser connection before falling back to the configured CORS proxy, Direct mode never uses or falls back to the proxy, and Proxy mode uses it immediately. Clear stale proxy settings when an existing Inspector connection changes modes, keep the server's built-in Inspector on direct origin-level OAuth metadata discovery when no proxy backend is mounted, bypass the browser HTTP cache for OAuth metadata so Origin-specific CORS responses cannot be reused across Inspector origins, make the server-tile Authenticate action clear stored OAuth discovery before starting a fresh flow, and discard authorization-server-generated client secrets from public browser DCR results instead of persisting them.

## 2.0.0-beta.9

### Patch Changes

- f3fc8da: Surface manual browser OAuth failures immediately instead of treating them as popup handoffs.

## 2.0.0-beta.8

### Patch Changes

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

## 2.0.0-beta.7

### Patch Changes

- bef150a: Expose the OAuth protected-resource URL with React auth tokens for consumers that perform server-side token refresh.

## 2.0.0-beta.6

### Patch Changes

- 7826695: Ship a Next.js drop-in adapter and harden sandbox view loading in the React client.

  **mcp-use**
  - Add `mcp-use/next` with `withMcpUse` and `createNextHandler` so MCP servers can mount inside Next.js App Router projects.
  - Teach `mcp-use dev` / `mcp-use build` to discover `--mcp-dir` / `--views-dir`, load Next-style `.env*` files, and shim Next server-only modules when building standalone from a Next host.
  - Add Next.js drop-in and standalone examples plus CI verification for the example suite.

  **@mcp-use/client**
  - Load blob sandboxes via `iframe.srcdoc` and delay blob URL revocation so React StrictMode remounts do not break view rendering.

## 2.0.0-beta.5

### Patch Changes

- c878835: Fix duplicated public assets in production builds and remove Scarf telemetry.

  **mcp-use**
  - Set `publicDir: false` on all Vite build steps so project `public/` is copied only to `.mcp-use/build/views/public/` (not duplicated at the build root or inside each view outDir).
  - Raise the view client build `chunkSizeWarningLimit` to reduce noisy warnings for large view bundles.

  **@mcp-use/client**
  - Remove Scarf download telemetry (`captureScarf`, beacon helpers, and related storage); PostHog remains the sole telemetry provider.

  **@mcp-use/inspector**
  - Drop inspector package-download Scarf tracking on init; update README and e2e docs to reflect PostHog-only telemetry.

## 2.0.0-beta.4

### Patch Changes

- 3294086: Stream partial tool-call arguments into the Inspector drawer and MCP App view while the model is generating them. Anthropic tool requests now opt into eager input streaming, partial JSON healing handles code and SVG strings correctly, hosted chat accepts tool-call start/delta frames, and the view host no longer overwrites newer partial input with a stale complete-input notification.

## 2.0.0-beta.3

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

## 2.0.0-beta.2

### Patch Changes

- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.

## 2.0.0-beta.1

### Patch Changes

- c7accd6: Fix standalone Inspector OAuth and CDN delivery.

  **@mcp-use/inspector**
  - Serve the built UI from `dist/cdn/` locally in standalone mode (`pnpm start` / `npx`); embedded mounts still default to jsDelivr `@beta`.
  - Point `pnpm start` at `dist/cli.js` so standalone runs the full proxy + OAuth BFF shell.
  - Skip `dev/info` tunnel probes in standalone mode (route exists only under `mcp-use dev`).
  - Simplify e2e matrix: builtin/prod modes rely on in-process static assets instead of a separate CDN fixture server.
  - Document jsDelivr-first embedding vs local standalone in `docs/inspector/integration.mdx`.

  **@mcp-use/client**
  - Fix Linear (and other OAuth) redirect flows: do not auto-connect saved MCP servers on `/oauth/callback`, which overwrote the PKCE verifier before token exchange.
  - Stop HEAD health-check polling after a 405/404 from servers that only accept POST (reduces console noise for providers like Linear).

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

- 0d9dd27: Default `jsonSchemaValidator` (`DialectJsonSchemaValidator`) now accepts JSON Schema draft-04/-07/2019-09 dialects emitted by v1-era servers, fixing `InvalidParams` on `callTool` for tools with `outputSchema` (issue #1839).
