# @mcp-use/server — v2 server rebuild

**Status:** Phase 1 (basic MCP pieces) implemented, plus the build/dev/start CLI and inspector CDN shell (contract in `CLI_SPEC.md`) and built-in request logging (§ Request logging). This document is the working contract; it is updated as each phase lands.
**Package:** `@mcp-use/server` (private during development; renamed/published as `mcp-use@2.x` at cutover, replacing `packages/mcp-use`).
**Branch target:** `v2`.

## Approach

Greenfield rebuild on the official v2 SDK (`@modelcontextprotocol/server`, stateless 2026-07-28 protocol), taken **piece by piece**. Each phase ports one coherent slice of the old package (`packages/mcp-use`, kept green as the **feature reference** until cutover). The old package defines *what* the server must be able to do, not what the API looks like: breaking API changes are explicitly allowed — and expected — wherever a different shape is better for users. Deltas vs the old package are still called out in the phase notes below so the migration guide can be written from them.

## Ground rules

- Official v2 SDK only, pinned exact while in beta — and always the **latest** beta: when a new `@modelcontextprotocol/*` beta publishes, bump all three pins (`server`, `hono`, dev `client`) together and re-run `test:run` (currently `2.0.0-beta.2`). SDK docs: <https://ts.sdk.modelcontextprotocol.io/v2/> — note the site tracks the SDK's main branch, so it may document exports that haven't reached a published beta yet. No v1 (`@modelcontextprotocol/sdk`) imports.
- **2026-07-28 wire only** (decided 2026-07-01). The package supports exactly one protocol revision: the stateless 2026-07-28 wire. `mountMcp` passes `legacy: "reject"` to `createMcpHandler` by default, so 2025-era requests get the unsupported-protocol-version error (`legacy: "stateless"` remains available as an explicit opt-in via `MountMcpOptions.handler` for transition deployments). Everything downstream assumes 2026 semantics: `structuredContent`/`outputSchema` accept any JSON root (not just objects), no legacy `{result: …}` wrapping exists in the type layer, and tests/examples speak only the modern envelope. Note for docs/migration: the official client's default posture is the legacy 2025 handshake — clients must opt in with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) to talk to these servers.
- **No response helpers** (removed 2026-07-01; supersedes the Phase-1 `text`/`object`/`array`/`error` design). Callbacks return the SDK's raw wire shapes — `CallToolResult` / `ReadResourceResult` / `GetPromptResult`, re-exported from the package root. Rationale: models are trained on the official SDK idiom and v1 evals showed they don't discover wrapper helpers; the raw shapes already typechecked, so the helpers were pure dialect. `array()` had also become actively wrong — its `{data}` wrap solved the 2025 object-root rule, while the 2026 wire takes array/primitive roots natively (and the SDK auto-appends the JSON text block for non-object `structuredContent`, SEP-2106). The one footgun the docs must carry: for **object-shaped** structured output the SDK appends no text fallback, so callbacks include both halves themselves — `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`.
- Schemas are typed against the SDK's [Standard Schema](https://standardschema.dev/) contracts, not zod: `schema`/`outputSchema` accept any `StandardSchemaWithJSON` (validation + JSON Schema conversion — zod v4, ArkType, Valibot, …); `completable()` needs only `StandardSchemaV1`. Both types are re-exported. Zod stays a **devDependency only** (tests/examples; it remains the documented example library) — no zod type in any public signature, and no runtime zod dependency either. A same-day 2026-07-02 relaxation to "declared internal dep" was reverted once auth was walked end to end: tokens are `jose`'s job, our RFC 9728 document is validated with the SDK's *own exported schema value* (calling `.parse()` on an imported object needs no zod dependency of ours), and adapter claim-mapping works from hand-declared interfaces + narrowing helpers (see `AUTH_SPEC.md` §Validation posture). Since internal zod would be invisible to users, this door stays open at zero migration cost if adapter mappers get gnarly in practice.
- Hono is the app shell, created via the official `@modelcontextprotocol/hono` adapter (`createMcpHonoApp`: JSON body parsing + Host/Origin validation); the MCP endpoint mounts via the SDK's `createMcpHandler` (fresh server per request — stateless, no session affinity). Prefer official adapters over hand-rolled plumbing wherever they exist.
- No feature may require session state; cross-request continuity uses explicit handles in results.
- No bin; no dependency on `@mcp-use/cli` or `@mcp-use/inspector` (direction is strictly `cli → inspector → server`).
- ESM-only (forced by the SDK). Node ≥ 24 (current LTS) — this package tracks the latest runtime, not the SDK's `>=20` floor.
- Dependencies track latest releases: caret ranges at current latest; TypeScript is a package-local devDep pinned to the TS 7 RC (native compiler; exact pin while pre-release — caret ranges don't traverse pre-releases; workspace root still pins 5.9 for the old packages). Watch the root `pnpm.overrides`: they *replace* this package's specifiers, so v1-era audit floors/pins there must be raised or removed when they'd hold this package back (hono/zod/vitest raised; the `@hono/node-server` floor removed so our `^2.x` applies while old packages keep `1.x`).
- Strict types: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; ESLint bans `any` and unsafe type flows (scoped block in root `eslint.config.js`). No SDK-private access; unavoidable SDK type warts get one contained, commented cast.
- Real tests only: e2e over HTTP with the official `@modelcontextprotocol/client`.
- Dependency budget: runtime deps stay minimal (`@modelcontextprotocol/server`, `hono`, `@hono/node-server`; `jose` when auth lands). Target install ≤ ~25 MB (vs 190 MB today).
- Do **not** port: session stores/StreamManager, registration-HMR (`hmr-sync.ts`), session recovery, SSE transport, the Express/Connect adapter, `posthog-js`. These are obsolete under the stateless model or moved upstream into the SDK.
- **No return-type accumulation** (considered and rejected 2026-07-01): `tool()`/`resource()`/`prompt()` return `this`, not `MCPServer<TTools & {...}>` (the tRPC/Hono/Skybridge pattern). The official v2 SDK does it on neither side (`registerTool` returns a `RegisteredTool` handle; client `callTool` is untyped), our client's primary job is connecting to *third-party* servers (no server type to import), and accumulation only sees literal chained calls — it structurally cannot type loop/conditional registration or OpenAPI-imported tools (Phase 6). **Typed clients and the Phase 5 React hooks (`useCallTool` etc.) are served by typegen from the registry / `tools/list` JSON Schema instead** (watch-mode regeneration is part of the Phase 5 CLI dev contract), which types all registration paths uniformly; same-repo code can also share Standard Schema objects directly. If zero-codegen instant types are ever demanded, the retrofittable escape hatch is a `defineTools({...})` object-literal helper + `InferToolMap<typeof tools>` — types from the literal, never from the class, so `MCPServer` stays non-generic either way. Callback types are plain function types (no bivariance hack); narrow→wide erasure happens at the registry `.set()` boundary via contained casts.

## Phase 1 — basic MCP pieces ✅

Scope: server identity, tools, resources, resource templates, prompts, completion, HTTP serving. Files: `src/server.ts` (MCPServer), `src/mount-mcp.ts` (standalone Hono mount), `src/config.ts` (ServerConfig), `src/context.ts` (RequestContext), one file per primitive's types (`src/tools.ts`, `src/resources.ts`, `src/prompts.ts`), `src/completable.ts`. Callbacks return raw SDK result shapes (see ground rules) — there is no results/conversion layer. Types-plus-tests typecheck runs via `tsconfig.test.json` (`pnpm typecheck`, part of `test:run`); compile-time contracts are pinned by `tests/type-level.test.ts` (`@ts-expect-error` + `expectTypeOf`).

Public API (shape shared with the old package where it happened to be right; deltas noted):

```ts
import { MCPServer, completable } from "@mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  title: "My Server",          // optional
  description: "…",            // optional
  instructions: "…",           // optional
  basePath: "/mcp",            // optional, default "/mcp"
  host: "127.0.0.1",           // optional; "0.0.0.0" for public listen()
  allowedHosts: undefined,     // optional, e.g. ["api.example.com"]; additive to localhost
  allowedOrigins: undefined,   // optional origin hostnames; defaults to the Host allowlist
  inspector: { enabled: true, assetsUrl: undefined }, // optional; see CLI_SPEC.md
  logging: { enabled: true, level: "info" },          // optional; see § Request logging
});

server.tool(
  {
    name: "fetch-weather",
    title: "Fetch weather",
    description: "…",
    schema: z.object({ city: z.string().describe("…") }),
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

await server.listen(3000);          // Node HTTP
const fetch = server.getHandler();  // web-standard handler (edge/tests)
server.basePath;                    // readonly accessor (default "/mcp") — lets tooling introspect the mount point
```

Result model (raw wire shapes; see the no-response-helpers ground rule): tool callbacks return the SDK's `CallToolResult`, resource callbacks `ReadResourceResult` (each `contents` entry addresses itself with the read `uri` and carries its own `mimeType`; the definition's `mimeType` is listing metadata only), prompt callbacks `GetPromptResult` (`description` passes through verbatim — the definition's is not injected). `ToolResult<TOutput>` in `src/tools.ts` encodes the SDK's runtime rule at compile time: tools **without** an `outputSchema` accept any `CallToolResult`; tools **with** one must return `structuredContent` matching the schema's inferred type — any JSON root, per the 2026 wire — or set `isError: true` (the SDK exempts `isError` results from output validation; anything else without `structuredContent` throws at call time).

Callback context (`ctx`, second parameter): `{ signal, request? }` — request-scoped only. It grows in later phases (auth, input-required elicitation, progress); nothing session-scoped will ever be added.

**Deltas vs the old package (protocol- or SDK-forced):**

1. `completable(...)` must wrap the *outer* schema: `.describe()` etc. go on the schema argument (`completable(z.string().describe("…"), values)`), because zod refinements clone the schema and drop the SDK's completion marker. `.optional()` after `completable()` still works (the SDK unwraps optionals).
2. Registrations are rejected after `listen()`/`getHandler()` — the registry is replayed per request, so late registration would be silently inconsistent. (The old package allowed live registration because it kept long-lived per-session servers; that model is gone.)
3. Invalid tool input surfaces as an `isError` tool result (SDK behavior), not a thrown protocol error.
4. Raw SDK result shapes (`{ content }`, `{ contents }`, `{ messages }`) are the **only** result model — the old package's `text()`/`object()`/`array()`/`error()` helpers are gone (see the no-response-helpers ground rule). Follow-on shape changes: resource callbacks receive the read URI (`(uri, ctx)` static, `(uri, params, ctx)` templated) since raw `contents` entries must address themselves; nothing injects a resource `mimeType` or a prompt `description` into results anymore — what the callback returns is what goes on the wire.
5. `listen()` binds `127.0.0.1` by default (old package: `0.0.0.0`) and localhost-class binds get Host/Origin validation (DNS-rebinding protection) automatically. Validation follows the threat model, not the adapter's host-keyed defaults: DNS rebinding targets locally bound servers, so `getHandler()` — which never binds and is expected to sit behind a platform edge that only routes the deployment's own hostnames — applies **no** validation unless `allowedHosts`/`allowedOrigins` are set, and a public `listen(host: "0.0.0.0")` serves unvalidated with a one-line warning. Configured `allowedHosts`/`allowedOrigins` are **additive** to the localhost allowlists (local runs keep working), and `allowedOrigins` defaults to mirroring the effective Host allowlist. The one guarded footgun: a localhost `listen()` after `getHandler()` already mounted the app without validation throws.
6. `schema`/`outputSchema` accept any Standard Schema validator with JSON Schema support (`StandardSchemaWithJSON`), not just zod (old package: zod peer dep). Zod v4 schemas work unchanged; zod is no longer a dependency of this package.
7. Tools declaring an `outputSchema` must return matching `structuredContent` or an `isError: true` result — content-only returns are a **compile-time** error (old package: compiled, then failed at call time in output validation). Not protocol-forced, but the protocol rule made real in types (`ToolResult<TOutput>` over raw `CallToolResult`); `tests/type-level.test.ts` pins it, including non-object schema roots (`z.array(…)`, `z.number()`).
8. `resourceTemplate()` uses a `const` type parameter so `uriTemplate` stays a string literal through inference — without it TS widens object-literal properties to `string` and template-param typing silently degrades to `Record<string, string | string[]>` (it had, undetected, before the type-level tests). Template inference handles RFC 6570 operators, comma-separated variable lists, and `*`/`:n` modifiers.
9. 2025-era clients are rejected (see the 2026-07-28-only ground rule). The official client must connect with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) — its default is the legacy handshake. Hand-rolled requests carry the per-request `_meta` envelope (`protocolVersion`/`clientInfo`/`clientCapabilities` keys) plus `mcp-protocol-version`/`mcp-method` headers, and `mcp-name` mirroring `params.name` on name-addressed methods; modern exchanges answer with a single JSON body (`responseMode: 'auto'`), not SSE framing.

**Intentionally absent from Phase 1** (land with their phase): `ctx.sample`/`ctx.elicit`/`ctx.auth`/`ctx.req` (Hono context), OAuth, middleware (`server.use`), notifications/subscriptions, views/widgets, landing page, OpenAPI import, telemetry, typegen, stdio serving.

**Examples** (`examples/vercel`, `examples/railway`): the two deployment doors, each verified end-to-end. Vercel = serverless via `getHandler()` exported as `export default { fetch }` from an `api/` function — zero host config (delta 5). Railway = long-lived `listen()` on `0.0.0.0` (bound only when `RAILWAY_PUBLIC_DOMAIN` is present), SIGINT/SIGTERM → `close()`.

## Request logging (landed 2026-07-06)

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
- **Config & exports.** `logging?: { enabled?: boolean; level?: "info" | "debug" | "trace" }` on `ServerConfig` (default enabled at `info`). The convention set here: on/off-with-options config fields are object-only with an `enabled` flag — no `boolean | object` unions (`inspector` was migrated to match). `requestLogger(options)`, `LoggingOptions`, and `LogLevel` are exported from the package root for hand-composed `mountMcp` apps.

## Later phases (each gets its own scope + delta notes before work starts)

- **Phase 2 — serving hardening:** auth seam (`authInfo` via `handler.fetch` → `ctx.http.authInfo`) — full contract in **`AUTH_SPEC.md`** (typed `ctx.auth.user`, provider adapters ported from v1, RFC 9728 metadata, proxy mode), mounting into a user's existing Hono app (validation middleware guidance), stdio serving decision (`serveStdio` works off the same factory), expose the underlying `McpServerFactory` (`server.factory()`) so any official adapter can consume it. Plus DX debts found building the examples: (1) `listen()`'s returned `url` is hardcoded to `localhost` — wrong for public binds; (2) no diagnostic when `basePath` drifts from where the handler is actually mounted (silent 404) — warn at `getHandler()` time; (3) document SIGINT/SIGTERM → `close()` as the container-platform integration pattern. *(Resolved ahead of phase: allowedHosts replacing the localhost allowlist → now additive with allowedOrigins mirroring; PaaS host-derivation helper → obsolete, getHandler() no longer validates Host by default — see delta 5.)*
- **Phase 3 — product shell:** OAuth providers + scope guards + `.well-known`, operation middleware (`server.use("mcp:*")`), landing page, notifications (`handler.notify`/bus) + resource subscriptions.
- **Phase 4 — elicitation & context:** `ctx.elicit` on `InputRequiredResult` (multi-round-trip), progress reporting; sampling/roots posture decision (deprecated in the 2026-07-28 spec — the SDK's legacy-path methods throw on modern-era requests).
- **Phase 5 — views (MCP Apps):** dual-protocol adapters, asset serving, dev contract with the CLI, React runtime, typegen. Public naming: **view** (widget only as wire/migration alias).
- **Phase 6 — integration & cutover:** OpenAPI import, telemetry (posthog-node, opt-out), repoint inspector/cli/templates, rename to `mcp-use`, delete the old package.

## Open questions (answered per phase, not up front)

- Sampling/roots: omit at v2.0 vs `@deprecated` legacy support (Phase 4).
- React view runtime: `/react` subpath vs separate package (Phase 5).
- `posthog-node`: hard dep with opt-out vs optional (Phase 6).
- Old `ServerConfig` fields not yet carried (`favicon`, `icons`, `websiteUrl`, OAuth): added with the features that read them.
