# mcp-use v2 — server framework contract

**Status:** Core MCP primitives, request logging, direct resource-server auth, views, and the complete CLI are implemented.
**Package:** `mcp-use@2`, published from `packages/server`.
**Branch target:** `v2`.

## Approach

Greenfield framework on the official v2 SDK (`@modelcontextprotocol/server`, stateless 2026-07-28 protocol), built in `packages/server`. It owns the server API and runtime plus the complete first-party CLI.

## Ground rules

- Official v2 SDK only, pinned as one coordinated set. The ext-apps PR #712 preview requires TypeScript SDK PR #2501, so `server`, development `client`, and development `core` use that PR's `pkg.pr.new` builds (package version `2.0.0-beta.4`) while `hono` uses registry `2.0.0-beta.4`. Replace all preview URLs with matching registry releases together, then re-run `test:run`. SDK docs: <https://ts.sdk.modelcontextprotocol.io/v2/>. No v1 (`@modelcontextprotocol/sdk`) imports.
- **2026-07-28 first.** The package is built for exactly one protocol revision — the stateless 2026-07-28 wire — but serves 2025-era clients through the SDK's stateless fallback: the default is `legacy: "stateless"` (each legacy request answered by a fresh instance over a session-less streamable HTTP transport; GET/DELETE session operations get `405`). The posture is public API: `ServerConfig.legacy` and `MountMcpOptions.handler.legacy` accept `"stateless" | "reject"`, where `"reject"` is modern-only strict (legacy-classified requests get the unsupported-protocol-version error). Everything downstream assumes 2026 semantics: `structuredContent`/`outputSchema` accept any JSON root (not just objects), no legacy `{result: …}` wrapping exists in the type layer, and tests/examples speak only the modern envelope. Note for docs/migration: the official client's default posture is the legacy 2025 handshake — clients opt in with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) to use the modern wire.
- **No response helpers, with one named exception.** Callbacks return the SDK's raw wire shapes — `CallToolResult` / `ReadResourceResult` / `GetPromptResult`, re-exported from the package root. Rationale: models are trained on the official SDK idiom and v1 evals showed they don't discover wrapper helpers; the raw shapes already typechecked, so v1's `text()`/`object()`/`array()`/`error()` were pure dialect. `array()` had also become actively wrong — its `{data}` wrap solved the 2025 object-root rule, while the 2026 wire takes array/primitive roots natively (and the SDK auto-appends the JSON text block for non-object `structuredContent`, SEP-2106). The one footgun the docs must carry: for **object-shaped** structured output the SDK appends no text fallback, so callbacks include both halves themselves — `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`. The exception is `view()` (`VIEWS_SPEC.md`): it is not dialect — it names the three tool-result channels, which differ in _who sees them_ — and it returns a plain `CallToolResult`.
- Schemas are typed against the SDK's [Standard Schema](https://standardschema.dev/) contracts, not zod: tool `inputSchema`/`outputSchema` (and prompt `schema`) accept any `StandardSchemaWithJSON` (validation + JSON Schema conversion — zod v4, ArkType, Valibot, …); `completable()` needs only `StandardSchemaV1`. Both types are re-exported. Zod stays a **devDependency only** (tests/examples; it remains the documented example library) — no zod type in any public signature, and no runtime zod dependency either. Nothing needs one, auth included: tokens are `jose`'s job, our RFC 9728 document is validated with the SDK's _own exported schema value_ (calling `.parse()` on an imported object needs no zod dependency of ours), and adapter claim-mapping works from hand-declared interfaces + narrowing helpers (see `AUTH_SPEC.md` §Validation posture). Since an internal validator would be invisible to users, adopting one later is a zero-migration change if adapter mappers get gnarly in practice.
- Hono is the app shell, created via the official `@modelcontextprotocol/hono` adapter (`createMcpHonoApp`: JSON body parsing + Host/Origin validation); the MCP endpoint mounts via the SDK's `createMcpHandler` (fresh server per request — stateless, no session affinity). Prefer official adapters over hand-rolled plumbing wherever they exist.
- No feature may require session state; cross-request continuity uses explicit handles in results.
- One framework package. `mcp-use` ships the server runtime and the complete first-party CLI: `dev`, `build`, `start`, cloud auth, organizations, servers, deployments, deploy, client, screenshot, and skills (`CLI_SPEC.md`). Each substantial command is a genuine lazy chunk; `dev` and `build` are separate chunks, and neither `start` nor a library export may statically evaluate Vite or unrelated command code.
- Vite is a regular dependency so `npm install mcp-use` is sufficient for `mcp-use dev` and `mcp-use build`. `@vitejs/plugin-react` becomes a regular dependency when views land. `react` and `react-dom` remain optional peers owned by view applications.
- `mcp-use` has no npm dependency edge of any kind to `@mcp-use/inspector`; embedded inspector integration is HTTP/CDN only. `@mcp-use/client` remains an independently published SDK and is a regular dependency used by the built-in `client` command without merging its public boundary into the framework.
- `create-mcp-use-app` remains a separately published, zero-runtime-dependency scaffolder. There is no `@mcp-use/config` package.
- ESM-only (forced by the SDK). Node ≥ 24 (current LTS) — this package tracks the latest runtime, not the SDK's `>=20` floor.
- Dependencies track latest releases: caret ranges at current latest; TypeScript is a package-local devDep pinned to the TS 7 RC (native compiler; exact pin while pre-release — caret ranges don't traverse pre-releases; workspace root still pins 5.9 for the old packages). Watch the root `pnpm.overrides`: they _replace_ this package's specifiers, so v1-era audit floors/pins there must be raised or removed when they'd hold this package back (hono/zod/vitest raised; the `@hono/node-server` floor removed so our `^2.x` applies while old packages keep `1.x`).
- Strict types: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; ESLint bans `any` and unsafe type flows (scoped block in root `eslint.config.js`). No SDK-private access; unavoidable SDK type warts get one contained, commented cast.
- Real tests only: e2e over HTTP with the official `@modelcontextprotocol/client`.
- Measurable budgets are tracked independently: installed package size (including the regular Vite toolchain), modules evaluated and startup time for `mcp-use start` and library imports, and production artifact size. A single blanket install-size ceiling must not trade away one-install dev/build or hide startup and artifact regressions.
- Do **not** port: session stores/StreamManager, registration-HMR (`hmr-sync.ts`), session recovery, SSE transport, the Express/Connect adapter, `posthog-js`. These are obsolete under the stateless model or moved upstream into the SDK.
- **No return-type accumulation; `MCPServer` stays non-generic.** Registration methods never return `MCPServer<TTools & {...}>` (the tRPC/Hono/Skybridge pattern). The official v2 SDK does it on neither side (`registerTool` returns a `RegisteredTool` handle; client `callTool` is untyped), our client's primary job is connecting to _third-party_ servers (no server type to import), and accumulation only sees literal chained calls — it structurally cannot type loop/conditional registration or OpenAPI-imported tools (the integration phase). The typed-hooks posture that replaces it lives in **`VIEWS_SPEC.md`**: when views land, `tool()` returns `ToolRef<Name, Input, Output>` (a handle, like the SDK's — this ends `.tool().tool()` chaining, which nothing uses today), typed `useCallTool`/`ViewProps` are pure inference over refs the user exports, and typegen is an explicit escape-hatch command only — never part of the dev/build hot path. `resource()`/`prompt()` keep returning `this` until a consumer needs refs. Currently implemented: `tool()`/`resource()`/`prompt()` all return `this`; the `ToolRef` change ships with views. Callback types are plain function types (no bivariance hack); narrow→wide erasure happens at the registry `.set()` boundary via contained casts.

## Phase 1 — basic MCP pieces ✅

Scope: server identity, tools, resources, resource templates, prompts, completion, HTTP serving, inspector shell. Files: `src/server.ts` (MCPServer), `src/mount-mcp.ts` (standalone Hono mount), `src/config.ts` (ServerConfig), `src/context.ts` (RequestContext), one file per primitive's types (`src/tools.ts`, `src/resources.ts`, `src/prompts.ts`), `src/completable.ts`, `src/inspector-shell.ts` (CDN shell route — contract in `CLI_SPEC.md`). The bin and toolchain (`src/bin*`, `src/cli/`) are governed by `CLI_SPEC.md`. Callbacks return raw SDK result shapes (see ground rules) — there is no results/conversion layer. Types-plus-tests typecheck runs via `tsconfig.test.json` (`pnpm typecheck`, part of `test:run`); compile-time contracts are pinned by `tests/type-level.test.ts` (`@ts-expect-error` + `expectTypeOf`).

Public API (shape shared with the old package where it happened to be right; deltas noted):

```ts
import { MCPServer, completable } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  title: "My Server", // optional
  description: "…", // optional; forwarded as implementation metadata
  instructions: "…", // optional
  basePath: "/mcp", // optional, default "/mcp"
  host: "127.0.0.1", // optional; "0.0.0.0" for public listen()
  allowedHosts: undefined, // optional, e.g. ["api.example.com"]; additive to localhost
  allowedOrigins: undefined, // optional origin hostnames; defaults to the Host allowlist
  legacy: "stateless", // optional; "reject" for modern-only strict (see ground rules)
  inspector: { enabled: true, assetsUrl: undefined }, // optional; see CLI_SPEC.md
  logging: { enabled: true, level: "info" }, // optional; see § Request logging
});

server.tool(
  {
    name: "fetch-weather",
    title: "Fetch weather",
    description: "…",
    inputSchema: z.object({ city: z.string().describe("…") }),
    outputSchema: z.object({ city: z.string(), temperature: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ city }, ctx) => {
    const data = { city, temperature: "22°C" };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

server.resource({ name: "config", uri: "config://settings" }, async (uri) => ({
  contents: [
    { uri: uri.href, mimeType: "application/json", text: `{"theme":"dark"}` },
  ],
}));

server.resourceTemplate(
  { name: "users", uriTemplate: "db://users/{id}" },
  async (uri, params, ctx) => ({
    contents: [{ uri: uri.href, text: String(params.id) }], // params typed from the template
  })
);

server.prompt(
  {
    name: "review-code",
    schema: z.object({
      language: completable(z.string().describe("…"), ["python", "go"]),
      code: z.string(),
    }),
  },
  async ({ language, code }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `Reviewing ${language}: ${code}` },
      },
    ],
  })
);

await server.listen(3000); // Node HTTP
const fetch = server.getHandler(); // web-standard handler (edge/tests)
server.basePath; // readonly accessor (default "/mcp") — lets tooling introspect the mount point
```

Result model (raw wire shapes; see the no-response-helpers ground rule): tool callbacks return the SDK's `CallToolResult`, resource callbacks `ReadResourceResult` (each `contents` entry addresses itself with the read `uri` and carries its own `mimeType`; the definition's `mimeType` is listing metadata only), prompt callbacks `GetPromptResult` (`description` passes through verbatim — the definition's is not injected). `ToolResult<TOutput>` in `src/tools.ts` encodes the SDK's runtime rule at compile time: tools **without** an `outputSchema` accept any `CallToolResult`; tools **with** one must return `structuredContent` matching the schema's inferred type — any JSON root, per the 2026 wire — or set `isError: true` (the SDK exempts `isError` results from output validation; anything else without `structuredContent` throws at call time).

Callback context (`ctx`, second parameter): `{ signal, request?, client, inputResponses?, requestState?, auth? }` — request-scoped only. `inputResponses` and `requestState` expose the official v2 multi-round-trip state; use the re-exported `inputRequired`, `inputResponse`, and `acceptedContent` helpers. `ctx.client` exposes per-request client capabilities (`VIEWS_SPEC.md`), and with OAuth configured, `ctx.auth` is present (`AUTH_SPEC.md` / `AUTH_IMPLEMENTATION.md`). Nothing session-scoped is added.

For the common human-input path, `ctx.input.form({ key, message, schema })`
combines correlation and Standard Schema validation. Return `form.result` when
`status === "required"`; accepted values are inferred from `schema`, while
decline, cancel, and invalid states remain explicit. `ctx.reportProgress(...)`
is request-scoped and returns `false` when the caller supplied no progress token.

**Deltas vs the old package (protocol- or SDK-forced):**

1. `completable(...)` must wrap the _outer_ schema: `.describe()` etc. go on the schema argument (`completable(z.string().describe("…"), values)`), because zod refinements clone the schema and drop the SDK's completion marker. `.optional()` after `completable()` still works (the SDK unwraps optionals).
2. Registrations are rejected after `listen()`/`getHandler()` — the registry is replayed per request, so late registration would be silently inconsistent. (The old package allowed live registration because it kept long-lived per-session servers; that model is gone.)
3. Invalid tool input surfaces as an `isError` tool result (SDK behavior), not a thrown protocol error.
4. Raw SDK result shapes (`{ content }`, `{ contents }`, `{ messages }`) are the **only** result model — the old package's `text()`/`object()`/`array()`/`error()` helpers are gone (see the no-response-helpers ground rule). Follow-on shape changes: resource callbacks receive the read URI (`(uri, ctx)` static, `(uri, params, ctx)` templated) since raw `contents` entries must address themselves; nothing injects a resource `mimeType` or a prompt `description` into results anymore — what the callback returns is what goes on the wire.
5. `listen()` binds `127.0.0.1` by default (old package: `0.0.0.0`) and localhost-class binds get DNS-rebinding protection automatically: `Host` on every request, `Origin` only on non-GET/HEAD (sandboxed view iframes send `Origin: null` on asset GETs; the MCP wire is POST). Validation follows the threat model, not the adapter's host-keyed defaults: DNS rebinding targets locally bound servers, so `getHandler()` — which never binds and is expected to sit behind a platform edge that only routes the deployment's own hostnames — applies **no** validation unless `allowedHosts`/`allowedOrigins` are set, and a public `listen(host: "0.0.0.0")` serves unvalidated with a one-line warning. Configured `allowedHosts`/`allowedOrigins` are **additive** to the localhost allowlists (local runs keep working), and `allowedOrigins` defaults to mirroring the effective Host allowlist. The one guarded footgun: a localhost `listen()` after `getHandler()` already mounted the app without validation throws.
6. `inputSchema`/`outputSchema` accept any Standard Schema validator with JSON Schema support (`StandardSchemaWithJSON`), not just zod (old package: zod peer dep). Tool definitions also accept `schema` as an alias for `inputSchema`. Zod v4 schemas work unchanged; zod is no longer a dependency of this package.
7. Tools declaring an `outputSchema` must return matching `structuredContent` or an `isError: true` result — content-only returns are a **compile-time** error (old package: compiled, then failed at call time in output validation). Not protocol-forced, but the protocol rule made real in types (`ToolResult<TOutput>` over raw `CallToolResult`); `tests/type-level.test.ts` pins it, including non-object schema roots (`z.array(…)`, `z.number()`).
8. `resourceTemplate()` uses a `const` type parameter so `uriTemplate` stays a string literal through inference — without it TS widens object-literal properties to `string` and template-param typing silently degrades to `Record<string, string | string[]>` (it had, undetected, before the type-level tests). Template inference handles RFC 6570 operators, comma-separated variable lists, and `*`/`:n` modifiers.
9. The modern wire is the per-request `_meta` envelope, not a handshake (see the 2026-07-28-first ground rule; 2025-era clients are served through the stateless legacy fallback by default, or rejected under `legacy: "reject"`). The official client connects modern with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) — its default is the legacy handshake. Hand-rolled modern requests carry the per-request `_meta` envelope (`protocolVersion`/`clientInfo`/`clientCapabilities` keys) plus `mcp-protocol-version`/`mcp-method` headers, and `mcp-name` mirroring `params.name` on name-addressed methods; modern exchanges answer with a single JSON body (`responseMode: 'auto'`), not SSE framing.

**Intentionally absent from the core primitive layer:** push-style `ctx.sample`/`ctx.elicit`, middleware (`server.use`), landing page, OpenAPI import, telemetry, typegen, and stdio serving. Views are governed by `VIEWS_SPEC.md`. The v2 MRTR primitives (`inputRequired`, `inputResponse`, `acceptedContent`) and cross-request notification methods are available without introducing session state.

**Examples** (`examples/vercel`, `examples/railway`): the two deployment doors, each verified end-to-end. Vercel = serverless via `getHandler()` exported as `export default { fetch }` from an `api/` function — zero host config (delta 5). Railway = the CLI entry contract (`CLI_SPEC.md`): the entry default-exports the server and never calls `listen()` itself; `mcp-use build` + `mcp-use start` own the socket (host selection via `RAILWAY_PUBLIC_DOMAIN` stays constructor config, which `start`'s `listen()` honors), and the bin handles SIGINT/SIGTERM → `close()`.

## Request logging

Built-in HTTP/MCP request logging (`src/logging.ts`), on by default. One summary line per HTTP request plus an indented detail line for MCP requests:

```text
12:45:01 POST /mcp 200 in 12ms
  tools/call greet cursor/1.2.0
```

Contract:

- **Format.** Summary line: `HH:MM:SS` UTC timestamp, HTTP verb, pathname, status (colored by class), duration. Detail line: plain two-space-indented ASCII (no box-drawing glyphs) carrying the MCP method (colored by namespace), its subject (tool name / resource URI / prompt name / `clientName/version` for initialize), and the calling client from the 2026-07-28 per-request `_meta` envelope (`io.modelcontextprotocol/clientInfo` — the stateless replacement for v1's session-id prefix; omitted on initialize, whose subject already is the client). Machine-parseable by construction: summary lines start with a timestamp, detail lines with whitespace. Tool `isError` results and JSON-RPC errors append `ERROR <message>`; the pair is emitted as one `console.log` so it stays atomic under concurrency.
- **Levels** (`logging.level`, overridden by the `MCP_USE_LOG_LEVEL` env var; `info` | `debug` | `trace`):
  - `info` (default): summary + detail only — **no request or response payloads**, so secrets in tool arguments/results stay out of production logs.
  - `debug`: echoes compact single-line input/output on the detail line, truncated at 80 chars — tool/prompt arguments, and `-> <result>` for `tools/call` (`structuredContent` when present, else a lone text block). Resource/prompt result payloads are never echoed (bulk content).
  - `trace`: debug plus a full request/response header+body dump after the pair (v1's `DEBUG=1` behavior).
- **Typed against the SDK, exhaustively.** Detail formatting is a table mapped over the SDK's `RequestMethod` union with params typed per method via `RequestTypeMap`; a new protocol method in an SDK bump is a **compile error** here until a formatter is chosen (the v1 logger's silent `[unknown-method]` fallback is the anti-pattern this replaces). Bodies are narrowed with `isJSONRPCRequest`, and the parsed body comes from `c.var.parsedBody` when `createMcpHonoApp` mounted the app (no re-parse; cloned+parsed only on bare apps).
- **Safety.** Credential headers (`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`) are `[REDACTED]` in trace dumps; request-derived strings (method/subject/client/error) are stripped of control characters so hostile values cannot forge log lines or emit terminal escapes; `subscriptions/listen` responses are never awaited for an outcome (unbounded SSE stream — reading it would block the middleware chain).
- **Colors** via a ~10-line internal ANSI helper — **no chalk/picocolors dependency** (dependency-budget ground rule). Honors `NO_COLOR`; plain text when stdout is not a TTY or absent (edge runtimes).
- **Noise.** Inspector shell page loads and favicon probes (GET/HEAD) are skipped; non-MCP requests log the summary line only.
- **Config & exports.** `logging?: { enabled?: boolean; level?: "info" | "debug" | "trace" }` on `ServerConfig` (default enabled at `info`). On/off-with-options config fields are object-only with an `enabled` flag — no `boolean | object` unions. `requestLogger(options)`, `LoggingOptions`, and `LogLevel` are exported from the package root for hand-composed `mountMcp` apps.

## Later phases (each gets its own scope + delta notes before work starts)

- **Build/dev/start CLI: implemented** — contract in **`CLI_SPEC.md`** (bin + lazily imported toolchain in this package, `.mcp-use/` workspace, inspector CDN shell, entry contract).
- **Views (MCP Apps): implemented** — contract in **`VIEWS_SPEC.md`** (single-protocol MCP Apps with no adapter system, `ToolRef`-based zero-codegen typing, `mcp-use/react` runtime, view naming throughout; extends the CLI contract with a client Vite environment).
- **Serving hardening:** mounting into a user's existing Hono app (validation middleware guidance) — `mountMcp` itself is implemented; stdio serving decision (`serveStdio` works off the same factory); expose the underlying `McpServerFactory` (`server.factory()`) so any official adapter can consume it. Plus DX debts found building the examples: (1) `listen()`'s returned `url` is hardcoded to `localhost` — wrong for public binds; (2) no diagnostic when `basePath` drifts from where the handler is actually mounted (silent 404) — warn at `getHandler()` time.
- **Auth: direct resource-server mode implemented; proxy mode deferred.** Contract in **`AUTH_SPEC.md`** / **`AUTH_IMPLEMENTATION.md`** (resource-server posture, `ctx.auth`, `bearerAuth`/`oauthMetadata`, provider adapters, RFC 9728 metadata). OAuth proxy mode (local authorization server) remains deferred.
- **Product shell:** OAuth providers + scope guards + `.well-known` (with auth, above), operation middleware (`server.use("mcp:*")`), landing page, and resource-subscription ergonomics. Cross-request v2 list/resource notifications are implemented through `MCPServer.notify*`, backed by the SDK handler bus. Every per-request SDK server advertises tool/prompt/resource `listChanged` (and resource `subscribe`) even while a registry is empty, so a client connected before the first primitive is added can subscribe. `getHandler({ bus })` accepts an SDK `ServerEventBus` for entries that need several handler instances to share open subscriptions; `mcp-use dev` uses one process-scoped bus across every reload generation and publishes all three list invalidations after a successful handler swap.
- **Elicitation & context:** MRTR state and helpers are implemented; future work may add higher-level form validation and progress ergonomics. Push-style sampling/roots remain legacy-only and are deprecated in the 2026-07-28 spec.
- **Integration:** OpenAPI import and telemetry (posthog-node, opt-out). The independently published `@mcp-use/client` remains the SDK boundary; the framework consumes it for `mcp-use client` rather than folding or re-exporting the SDK from the server runtime.

## Open questions (answered per phase, not up front)

- Sampling/roots: omit at v2.0 vs `@deprecated` legacy support (elicitation & context phase).
- `posthog-node`: hard dep with opt-out vs optional (cutover phase).
- Old `ServerConfig` fields not yet carried (`favicon`, `icons`, `websiteUrl`, OAuth): added with the features that read them.
