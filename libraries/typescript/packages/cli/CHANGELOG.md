# @mcp-use/cli

## 4.0.1

### Patch Changes

- 33e30cb: fix(cli): accept package-manager argument forwarding across commands

## 4.0.1-canary.2

### Patch Changes

- Updated dependencies [4ea75fd]
  - @mcp-use/client@2.0.1-canary.0

## 4.0.1-canary.1

### Patch Changes

- b4abd43: fix(cli): accept package-manager argument forwarding across commands

## 4.0.1-canary.0

### Patch Changes

- @mcp-use/inspector@20.0.1-canary.0

## 4.0.0

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

- e53c958: Add `mcp-use login --device-code <code>` for securely redeeming short-lived, pre-approved device codes in non-interactive onboarding flows.
- c991412: Remove the `mcp-use skills` command from the CLI. Coding-agent skills remain
  available through the `create-mcp-use-app` setup flow.
- 8259292: Add `mcp-use start --tunnel` for production builds. The command waits for the server to bind, tunnels the actual port, prints the public MCP URL, reuses saved tunnel state, and releases the tunnel during startup failure or graceful shutdown. It composes with `--host` and `--with-inspector` while keeping tunnel code out of ordinary production startup.
- 192d193: Require `useCallTool("name")` names to resolve to exported server `ToolRef`
  values once `mcp-env.d.ts` registers the server entry. Add
  `useDynamicTool<Args, Result>("name")` as the explicit escape hatch for tools
  registered from runtime data, loops, or OpenAPI documents.

  Add `mcp-use typecheck`, which refreshes the managed `mcp-env.d.ts` entry
  bridge and then invokes the project's local TypeScript compiler with
  `--noEmit`. New projects scaffold the declaration and use this command in
  their `typecheck` script.

### Patch Changes

- 8456b15: Keep `mcp-use/react` out of Vite's dependency bundle while explicitly optimizing its CommonJS React dependencies, and apply React deduplication at the dev server's final config layer. This makes dependency and view imports share one React dispatcher.
- e451e20: Bundle the Vite and Tailwind build pipeline in the CLI so generated projects do not need build-tool dependencies.
- 54567d5: Keep managed views on one deduplicated React runtime and configure Zod's supported jitless mode before view dependencies evaluate. This prevents invalid hook calls in development and removes the caught `eval` CSP violation without weakening the view sandbox policy.
- b5151b5: Fix CLI package verification on Windows by converting the package file URL to a native path before scanning `dist`.
- a4c9c35: Install the Vite and Tailwind build pipeline with the CLI while keeping generated project manifests free of build-tool dependencies.
- 9eb99e4: Allow tool-only servers to build and run without a views directory or React
  view component.

  `mcp-use build` and `mcp-use dev` now prime and validate an empty view registry,
  log when the views directory is not configured, and preserve the precise
  view-binding error when a tool references a view that does not exist.

- a3edf35: Provide Vite client types through `mcp-use` so generated projects can import CSS, SVG, and other supported assets without maintaining custom declarations or depending directly on Vite.
- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- 4b9e621: improve cli ux
- c1c6c2b: Publish the optimized standalone Inspector and CLI packaging: ordinary mcp-use installs avoid the Inspector UI dependency graph, while Inspector, client tooling, and production opt-ins remain available on demand.
- 1a9b6fb: Correct framework and standalone CLI version reporting, and harden the packaged edge, start, dependency, and clean-install boundaries.
- 50df3a1: Refresh scaffold and example dependency pins: TypeScript `^7.0.2` (stable, replaces `7.0.1-rc`) and React `^19.2.7`.

## 4.0.0-beta.15

### Patch Changes

- 4b9e621: improve cli ux

## 4.0.0-beta.14

### Patch Changes

- 8456b15: Keep `mcp-use/react` out of Vite's dependency bundle while explicitly optimizing its CommonJS React dependencies, and apply React deduplication at the dev server's final config layer. This makes dependency and view imports share one React dispatcher.

## 4.0.0-beta.13

### Patch Changes

- 54567d5: Keep managed views on one deduplicated React runtime and configure Zod's supported jitless mode before view dependencies evaluate. This prevents invalid hook calls in development and removes the caught `eval` CSP violation without weakening the view sandbox policy.

## 4.0.0-beta.12

### Patch Changes

- 9eb99e4: Allow tool-only servers to build and run without a views directory or React
  view component.

  `mcp-use build` and `mcp-use dev` now prime and validate an empty view registry,
  log when the views directory is not configured, and preserve the precise
  view-binding error when a tool references a view that does not exist.

## 4.0.0-beta.11

### Patch Changes

- a3edf35: Provide Vite client types through `mcp-use` so generated projects can import CSS, SVG, and other supported assets without maintaining custom declarations or depending directly on Vite.

## 4.0.0-beta.10

### Minor Changes

- e53c958: Add `mcp-use login --device-code <code>` for securely redeeming short-lived, pre-approved device codes in non-interactive onboarding flows.

## 4.0.0-beta.9

### Minor Changes

- c991412: Remove the `mcp-use skills` command from the CLI. Coding-agent skills remain
  available through the `create-mcp-use-app` setup flow.

## 4.0.0-beta.8

### Patch Changes

- 1a9b6fb: Correct framework and standalone CLI version reporting, and harden the packaged edge, start, dependency, and clean-install boundaries.

## 4.0.0-beta.7

### Patch Changes

- b5151b5: Fix CLI package verification on Windows by converting the package file URL to a native path before scanning `dist`.

## 4.0.0-beta.6

### Minor Changes

- 8259292: Add `mcp-use start --tunnel` for production builds. The command waits for the server to bind, tunnels the actual port, prints the public MCP URL, reuses saved tunnel state, and releases the tunnel during startup failure or graceful shutdown. It composes with `--host` and `--with-inspector` while keeping tunnel code out of ordinary production startup.

## 4.0.0-beta.5

### Minor Changes

- 192d193: Require `useCallTool("name")` names to resolve to exported server `ToolRef`
  values once `mcp-env.d.ts` registers the server entry. Add
  `useDynamicTool<Args, Result>("name")` as the explicit escape hatch for tools
  registered from runtime data, loops, or OpenAPI documents.

  Add `mcp-use typecheck`, which refreshes the managed `mcp-env.d.ts` entry
  bridge and then invokes the project's local TypeScript compiler with
  `--noEmit`. New projects scaffold the declaration and use this command in
  their `typecheck` script.

## 4.0.0-beta.4

### Patch Changes

- a4c9c35: Install the Vite and Tailwind build pipeline with the CLI while keeping generated project manifests free of build-tool dependencies.

## 4.0.0-beta.3

### Patch Changes

- e451e20: Bundle the Vite and Tailwind build pipeline in the CLI so generated projects do not need build-tool dependencies.

## 4.0.0-beta.2

### Patch Changes

- c1c6c2b: Publish the optimized standalone Inspector and CLI packaging: ordinary mcp-use installs avoid the Inspector UI dependency graph, while Inspector, client tooling, and production opt-ins remain available on demand.

## 4.0.0-beta.1

### Patch Changes

- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- 50df3a1: Refresh scaffold and example dependency pins: TypeScript `^7.0.2` (stable, replaces `7.0.1-rc`) and React `^19.2.7`.
- Updated dependencies [4810321]
- Updated dependencies [b47e268]
- Updated dependencies [1579839]
- Updated dependencies [50df3a1]
  - mcp-use@2.0.0-beta.12

## 4.0.0-beta.0

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

- Updated dependencies [a9ba017]
- Updated dependencies [b4c192e]
- Updated dependencies [0d9dd27]
  - mcp-use@2.0.0-beta.0
