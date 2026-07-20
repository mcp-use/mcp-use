# @mcp-use/client

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
