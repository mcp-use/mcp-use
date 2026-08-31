# @mcp-use/agent

## 2.0.11

### Patch Changes

- Updated dependencies [82772dc]
  - @mcp-use/client@2.2.2

## 2.0.11-canary.0

### Patch Changes

- Updated dependencies [fed8d64]
  - @mcp-use/client@2.2.2-canary.0

## 2.0.10

### Patch Changes

- Updated dependencies [f2f4fdb]
  - @mcp-use/client@2.2.1

## 2.0.10-canary.0

### Patch Changes

- Updated dependencies [45dd7f2]
  - @mcp-use/client@2.2.1-canary.0

## 2.0.9

### Patch Changes

- Updated dependencies [1af9beb]
  - @mcp-use/client@2.2.0

## 2.0.9-canary.0

### Patch Changes

- Updated dependencies [3461646]
  - @mcp-use/client@2.2.0-canary.0

## 2.0.8

### Patch Changes

- d0107b3: Count Anthropic cache tokens in usage totals, and stop `message_delta` erasing the input and cache counters captured at `message_start`. Anthropic reports `cache_read_input_tokens` and `cache_creation_input_tokens` outside `input_tokens` and bills all of them, so a total of input plus output undercounts what the call cost. OpenAI's cached tokens sit inside `prompt_tokens`, so they are left alone.

## 2.0.8-canary.0

### Patch Changes

- 0833b32: Count Anthropic cache tokens in usage totals, and stop `message_delta` erasing the input and cache counters captured at `message_start`. Anthropic reports `cache_read_input_tokens` and `cache_creation_input_tokens` outside `input_tokens` and bills all of them, so a total of input plus output undercounts what the call cost. OpenAI's cached tokens sit inside `prompt_tokens`, so they are left alone.

## 2.0.7

### Patch Changes

- Updated dependencies [bdd8ec8]
  - @mcp-use/client@2.1.5

## 2.0.7-canary.0

### Patch Changes

- Updated dependencies [bdd8ec8]
  - @mcp-use/client@2.1.5-canary.0

## 2.0.6

### Patch Changes

- Updated dependencies [6343150]
- Updated dependencies [c9c944b]
  - @mcp-use/client@2.1.4

## 2.0.6-canary.1

### Patch Changes

- Updated dependencies [6343150]
  - @mcp-use/client@2.1.4-canary.1

## 2.0.6-canary.0

### Patch Changes

- Updated dependencies [c9c944b]
  - @mcp-use/client@2.1.4-canary.0

## 2.0.5

### Patch Changes

- Updated dependencies [aba4346]
- Updated dependencies [aba4346]
  - @mcp-use/client@2.1.3

## 2.0.5-canary.1

### Patch Changes

- Updated dependencies [0e65b00]
  - @mcp-use/client@2.1.3-canary.1

## 2.0.5-canary.0

### Patch Changes

- Updated dependencies [77ceb91]
  - @mcp-use/client@2.1.3-canary.0

## 2.0.4

### Patch Changes

- Updated dependencies [4104309]
  - @mcp-use/client@2.1.2

## 2.0.4-canary.0

### Patch Changes

- Updated dependencies [f18ba62]
  - @mcp-use/client@2.1.2-canary.0

## 2.0.3

### Patch Changes

- Updated dependencies [e17cd7b]
- Updated dependencies [e17cd7b]
- Updated dependencies [e17cd7b]
- Updated dependencies [e17cd7b]
- Updated dependencies [e17cd7b]
- Updated dependencies [e17cd7b]
  - @mcp-use/client@2.1.1

## 2.0.3-canary.4

### Patch Changes

- Updated dependencies [b4caaa3]
  - @mcp-use/client@2.1.1-canary.4

## 2.0.3-canary.3

### Patch Changes

- Updated dependencies [e7ca969]
  - @mcp-use/client@2.1.1-canary.3

## 2.0.3-canary.2

### Patch Changes

- Updated dependencies [6c310bf]
  - @mcp-use/client@2.1.1-canary.2

## 2.0.3-canary.1

### Patch Changes

- Updated dependencies [c5262c9]
  - @mcp-use/client@2.1.1-canary.1

## 2.0.3-canary.0

### Patch Changes

- Updated dependencies [1c3e40b]
  - @mcp-use/client@2.1.1-canary.0

## 2.0.2

### Patch Changes

- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

- Updated dependencies [60eb3ac]
- Updated dependencies [792e8eb]
- Updated dependencies [52f535c]
- Updated dependencies [6985d78]
- Updated dependencies [2daf9c9]
  - @mcp-use/client@2.1.0

## 2.0.2-canary.5

### Patch Changes

- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

- Updated dependencies [60eb3ac]
- Updated dependencies [792e8eb]
- Updated dependencies [819ef5b]
- Updated dependencies [52f535c]
- Updated dependencies [6985d78]
- Updated dependencies [2daf9c9]
  - @mcp-use/client@2.1.0-canary.5

## 2.0.2-canary.4

### Patch Changes

- Updated dependencies [792e8eb]
  - @mcp-use/client@2.1.0-canary.4

## 2.0.2-canary.3

### Patch Changes

- Updated dependencies [819ef5b]
- Updated dependencies [2daf9c9]
  - @mcp-use/client@2.1.0-canary.3

## 2.0.2-canary.2

### Patch Changes

- 6985d78: chore: clear unused TypeScript export surface flagged by knip

  Trim internal barrels, drop dead stubs and duplicate re-exports, and un-export file-local helpers so knip reports a clean export graph without changing published package entry APIs.

- Updated dependencies [6985d78]
  - @mcp-use/client@2.0.2-canary.2

## 2.0.2-canary.1

### Patch Changes

- Updated dependencies [60eb3ac]
  - @mcp-use/client@2.0.2-canary.1

## 2.0.2-canary.0

### Patch Changes

- Updated dependencies [52f535c]
  - @mcp-use/client@2.0.2-canary.0

## 2.0.1

### Patch Changes

- Updated dependencies [33e30cb]
- Updated dependencies [33e30cb]
  - @mcp-use/client@2.0.1

## 2.0.1-canary.1

### Patch Changes

- Updated dependencies [f5a765f]
  - @mcp-use/client@2.0.1-canary.1

## 2.0.1-canary.0

### Patch Changes

- Updated dependencies [4ea75fd]
  - @mcp-use/client@2.0.1-canary.0

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

- 585c254: Default `autoInitialize` to on in simplified mode so `run()` works without a manual `initialize()` call. Drop the `@mcp-use/agent/browser` entry — use `@mcp-use/agent` in Node and the browser. Remove `chalk` and `cli-highlight` (pretty terminal output uses a small inline ANSI helper). Re-export `MCPAgent` from `@mcp-use/agent/langchain`, add package examples, and clarify install docs (`@mcp-use/client` is a dependency; `/langchain` is a subpath).

### Patch Changes

- 3180df7: Make `@mcp-use/agent` ESM-only for v2. The root, browser, and LangChain entry points no longer publish CommonJS builds or advertise `require()` conditions; use ESM `import` or dynamic `import()` from a CommonJS host.
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

- f06deff: Harden the v2 beta release train and package boundaries before GA.
  - Reject prerelease plans that would reuse or lag an npm beta version, and keep Inspector versioned with the exact `mcp-use` beta it supports.
  - Use the modern Langfuse LangChain adapter so the Agent's optional LangChain and observability peers resolve together.
  - Keep Inspector framework peers optional for standalone installs and refresh public v2 server and MCP Apps documentation.

- b4c192e: Enable localhost managed inspector chat via browser MCPAgent and the cloud LLM proxy. Anonymous users must sign in; authenticated usage draws from Autumn `llm_tokens` credits.
- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- 95d286e: Replace the transitive `pkg.pr.new` MCP v2 preview dependencies with registry-published SDK beta packages and the temporary npm build of ext-apps PR #720.
- f3ec4c5: Update the official MCP split SDK dependencies and the temporary ext-apps PR #720 build to stable 2.0.0 releases.
- 3294086: Stream partial tool-call arguments into the Inspector drawer and MCP App view while the model is generating them. Anthropic tool requests now opt into eager input streaming, partial JSON healing handles code and SVG strings correctly, hosted chat accepts tool-call start/delta frames, and the view host no longer overwrites newer partial input with a stale complete-input notification.
- 8d856b6: Export the public option, event, adapter, provider, server-manager, and observability types referenced by the agent entrypoints.
- Updated dependencies [c878835]
- Updated dependencies [3aca19c]
- Updated dependencies [24d2024]
- Updated dependencies [a9ba017]
- Updated dependencies [ac3d1eb]
- Updated dependencies [0d9dd27]
- Updated dependencies [bef150a]
- Updated dependencies [f3fc8da]
- Updated dependencies [eedeb4f]
- Updated dependencies [a3d8591]
- Updated dependencies [c7accd6]
- Updated dependencies [7826695]
- Updated dependencies [b47e268]
- Updated dependencies [1579839]
- Updated dependencies [95d286e]
- Updated dependencies [f3ec4c5]
- Updated dependencies [da86879]
- Updated dependencies [3294086]
- Updated dependencies [be2dd8e]
- Updated dependencies [a6ec149]
- Updated dependencies [f259641]
  - @mcp-use/client@2.0.0

## 2.0.0-beta.22

### Patch Changes

- f06deff: Harden the v2 beta release train and package boundaries before GA.
  - Reject prerelease plans that would reuse or lag an npm beta version, and keep Inspector versioned with the exact `mcp-use` beta it supports.
  - Use the modern Langfuse LangChain adapter so the Agent's optional LangChain and observability peers resolve together.
  - Keep Inspector framework peers optional for standalone installs and refresh public v2 server and MCP Apps documentation.

## 2.0.0-beta.21

### Patch Changes

- Updated dependencies [a6ec149]
  - @mcp-use/client@2.0.0-beta.18

## 2.0.0-beta.20

### Patch Changes

- f3ec4c5: Update the official MCP split SDK dependencies and the temporary ext-apps PR #720 build to stable 2.0.0 releases.
- Updated dependencies [f3ec4c5]
  - @mcp-use/client@2.0.0-beta.17

## 2.0.0-beta.19

### Patch Changes

- 8d856b6: Export the public option, event, adapter, provider, server-manager, and observability types referenced by the agent entrypoints.

## 2.0.0-beta.18

### Minor Changes

- 585c254: Default `autoInitialize` to on in simplified mode so `run()` works without a manual `initialize()` call. Drop the `@mcp-use/agent/browser` entry — use `@mcp-use/agent` in Node and the browser. Remove `chalk` and `cli-highlight` (pretty terminal output uses a small inline ANSI helper). Re-export `MCPAgent` from `@mcp-use/agent/langchain`, add package examples, and clarify install docs (`@mcp-use/client` is a dependency; `/langchain` is a subpath).

## 2.0.0-beta.17

### Patch Changes

- Updated dependencies [be2dd8e]
  - @mcp-use/client@2.0.0-beta.16

## 2.0.0-beta.16

### Patch Changes

- Updated dependencies [da86879]
  - @mcp-use/client@2.0.0-beta.15

## 2.0.0-beta.15

### Patch Changes

- Updated dependencies [24d2024]
  - @mcp-use/client@2.0.0-beta.14

## 2.0.0-beta.14

### Patch Changes

- Updated dependencies [ac3d1eb]
  - @mcp-use/client@2.0.0-beta.13

## 2.0.0-beta.13

### Patch Changes

- 95d286e: Replace the transitive `pkg.pr.new` MCP v2 preview dependencies with registry-published SDK beta packages and the temporary npm build of ext-apps PR #720.
- Updated dependencies [95d286e]
  - @mcp-use/client@2.0.0-beta.12

## 2.0.0-beta.12

### Patch Changes

- Updated dependencies [eedeb4f]
  - @mcp-use/client@2.0.0-beta.11

## 2.0.0-beta.11

### Patch Changes

- Updated dependencies [a3d8591]
  - @mcp-use/client@2.0.0-beta.10

## 2.0.0-beta.10

### Patch Changes

- Updated dependencies [f3fc8da]
  - @mcp-use/client@2.0.0-beta.9

## 2.0.0-beta.9

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

- Updated dependencies [3aca19c]
  - @mcp-use/client@2.0.0-beta.8

## 2.0.0-beta.8

### Patch Changes

- Updated dependencies [bef150a]
  - @mcp-use/client@2.0.0-beta.7

## 2.0.0-beta.7

### Patch Changes

- Updated dependencies [7826695]
  - @mcp-use/client@2.0.0-beta.6

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [c878835]
  - @mcp-use/client@2.0.0-beta.5

## 2.0.0-beta.5

### Patch Changes

- 3294086: Stream partial tool-call arguments into the Inspector drawer and MCP App view while the model is generating them. Anthropic tool requests now opt into eager input streaming, partial JSON healing handles code and SVG strings correctly, hosted chat accepts tool-call start/delta frames, and the view host no longer overwrites newer partial input with a stale complete-input notification.
- Updated dependencies [3294086]
  - @mcp-use/client@2.0.0-beta.4

## 2.0.0-beta.4

### Patch Changes

- 3180df7: Make `@mcp-use/agent` ESM-only for v2. The root, browser, and LangChain entry points no longer publish CommonJS builds or advertise `require()` conditions; use ESM `import` or dynamic `import()` from a CommonJS host.

## 2.0.0-beta.3

### Patch Changes

- Updated dependencies [f259641]
  - @mcp-use/client@2.0.0-beta.3

## 2.0.0-beta.2

### Patch Changes

- b47e268: Raise the Node.js engine floor from `>=20.19.0` to `>=22.13.0` across published packages, scaffolds, examples, CI, Docker, and esbuild/tsup build targets. Use `@types/node` `^22.13.0`. Required for pnpm 11.13 in GitHub Actions and unblocks the beta release workflow.
- 1579839: Raise the Node.js engine floor to `>=22.22.2` (post–March 2026 security release) and pin CI to Node 22.23.1 so trusted npm 12 publishing works.
- Updated dependencies [b47e268]
- Updated dependencies [1579839]
  - @mcp-use/client@2.0.0-beta.2

## 2.0.0-beta.1

### Patch Changes

- Updated dependencies [c7accd6]
  - @mcp-use/client@2.0.0-beta.1

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
- Updated dependencies [a9ba017]
- Updated dependencies [0d9dd27]
  - @mcp-use/client@2.0.0-beta.0
