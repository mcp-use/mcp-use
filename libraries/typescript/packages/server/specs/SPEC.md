# mcp-use v2 — server framework contract

**Status:** Core MCP primitives, request logging, landing page, direct resource-server auth, views, and the complete CLI are implemented.
**Package:** `mcp-use@2`, published from `packages/server`.
**Branch target:** `v2`.

## Approach

Greenfield framework on the official v2 SDK (`@modelcontextprotocol/server`, stateless 2026-07-28 protocol), built in `packages/server`. It owns the server API and runtime plus the complete first-party CLI.

## Ground rules

- Official v2 SDK only, pinned as one coordinated set. The ext-apps PR #712 preview requires TypeScript SDK PR #2501, so `server`, development `client`, and development `core` use that PR's `pkg.pr.new` builds (package version `2.0.0-beta.4`). Replace all preview URLs with matching registry releases together, then re-run `test:run`. SDK docs: <https://ts.sdk.modelcontextprotocol.io/v2/>. No v1 (`@modelcontextprotocol/sdk`) imports.
- **2026-07-28 first.** The package is built for exactly one protocol revision — the stateless 2026-07-28 wire — but serves 2025-era clients through the SDK's stateless fallback: the default is `legacy: "stateless"` (each legacy request answered by a fresh instance over a session-less streamable HTTP transport; GET/DELETE session operations get `405`). The posture is public API: `ServerConfig.legacy` and `MountMcpOptions.handler.legacy` accept `"stateless" | "reject"`, where `"reject"` is modern-only strict (legacy-classified requests get the unsupported-protocol-version error). Everything downstream assumes 2026 semantics: `structuredContent`/`outputSchema` accept any JSON root (not just objects), no legacy `{result: …}` wrapping exists in the type layer, and tests/examples speak only the modern envelope. Note for docs/migration: the official client's default posture is the legacy 2025 handshake — clients opt in with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) to use the modern wire.
- **No response helpers, with one named exception.** Callbacks return the SDK's raw wire shapes — `CallToolResult` / `ReadResourceResult` / `GetPromptResult`, re-exported from the package root. Rationale: models are trained on the official SDK idiom and v1 evals showed they don't discover wrapper helpers; the raw shapes already typechecked, so v1's `text()`/`object()`/`array()`/`error()` were pure dialect. `array()` had also become actively wrong — its `{data}` wrap solved the 2025 object-root rule, while the 2026 wire takes array/primitive roots natively (and the SDK auto-appends the JSON text block for non-object `structuredContent`, SEP-2106). The one footgun the docs must carry: for **object-shaped** structured output the SDK appends no text fallback, so callbacks include both halves themselves — `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`. The exception is `view()` (`VIEWS_SPEC.md`): it is not dialect — it names the three tool-result channels, which differ in _who sees them_ — and it returns a plain `CallToolResult`.
- Schemas are typed against the SDK's [Standard Schema](https://standardschema.dev/) contracts, not zod: tool `inputSchema`/`outputSchema` (and prompt `schema`) accept any `StandardSchemaWithJSON` (validation + JSON Schema conversion — zod v4, ArkType, Valibot, …); `completable()` needs only `StandardSchemaV1`. Both types are re-exported. Zod stays a **devDependency only** (tests/examples; it remains the documented example library) — no zod type in any public signature, and no runtime zod dependency either. Nothing needs one, auth included: tokens are `jose`'s job, our RFC 9728 document is validated with the SDK's _own exported schema value_ (calling `.parse()` on an imported object needs no zod dependency of ours), and adapter claim-mapping works from hand-declared interfaces + narrowing helpers (see `AUTH_SPEC.md` §Validation posture). Since an internal validator would be invisible to users, adopting one later is a zero-migration change if adapter mappers get gnarly in practice.
- The HTTP app shell is fetch-native: `composeFetch` / `routeFetch` middleware plus SDK validation helpers (`hostHeaderValidationResponse`, `originValidationResponse`). The MCP endpoint mounts via the SDK's `createMcpHandler` (fresh server per request — stateless, no session affinity). Node `listen()` and `mcp-use dev` use a vendored `toNodeHandler` bridge (`mcp-use/node`) with no Hono dependency.
- No feature may require session state; cross-request continuity uses explicit handles in results.
- One framework package. `mcp-use` ships the server runtime and the complete first-party CLI: `dev`, `build`, `start`, cloud auth, organizations, servers, deployments, deploy, client, screenshot, and skills (`CLI_SPEC.md`). Each substantial command is a genuine lazy chunk; `dev` and `build` are separate chunks, and neither `start` nor a library export may statically evaluate Vite or unrelated command code.
- Vite is a regular dependency so `npm install mcp-use` is sufficient for `mcp-use dev` and `mcp-use build`. `@vitejs/plugin-react` becomes a regular dependency when views land. `react` and `react-dom` remain optional peers owned by view applications.
- `mcp-use` has no npm dependency edge of any kind to `@mcp-use/inspector`; embedded inspector integration is HTTP/CDN only. `@mcp-use/client` remains an independently published SDK and an **optional peer** — `server.proxy()`, `mcp-use client`, and `mcp-use screenshot` load it on demand and print install instructions when it is missing; the library entry and `start` never evaluate it.
- `create-mcp-use-app` remains a separately published, zero-runtime-dependency scaffolder. There is no `@mcp-use/config` package.
- ESM-only (forced by the SDK). Node ≥ 22.13.0 — floor set by bundled Vite 8; matches MCP SDK `>=20` and a single minimum across published packages.
- Dependencies track latest releases: caret ranges at current latest; TypeScript is a package-local devDep on TS 7 (`^7.0.2`; workspace root still pins 5.9 for the old packages). Watch the root `pnpm.overrides`: they _replace_ this package's specifiers, so v1-era audit floors/pins there must be raised or removed when they'd hold this package back (zod/vitest raised).
- Strict types: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`; ESLint bans `any` and unsafe type flows (scoped block in root `eslint.config.js`). No SDK-private access; unavoidable SDK type warts get one contained, commented cast.
- Real tests only: e2e over HTTP with the official `@modelcontextprotocol/client`.
- Measurable budgets are tracked independently: installed package size (including the regular Vite toolchain), modules evaluated and startup time for `mcp-use start` and library imports, and production artifact size. A single blanket install-size ceiling must not trade away one-install dev/build or hide startup and artifact regressions.
- Do **not** port: session stores/StreamManager, registration-HMR (`hmr-sync.ts`), session recovery, SSE transport, the Express/Connect adapter, `posthog-js`. These are obsolete under the stateless model or moved upstream into the SDK.
- **No return-type accumulation; `MCPServer` stays non-generic.** Registration methods never return `MCPServer<TTools & {...}>` (the tRPC/Hono/Skybridge pattern). The official v2 SDK does it on neither side (`registerTool` returns a `RegisteredTool` handle; client `callTool` is untyped), our client's primary job is connecting to _third-party_ servers (no server type to import), and accumulation only sees literal chained calls — it structurally cannot type loop/conditional registration or OpenAPI-imported tools (the integration phase). The typed-hooks posture that replaces it lives in **`VIEWS_SPEC.md`**: when views land, `tool()` returns `ToolRef<Name, Input, Output>` (a handle, like the SDK's — this ends `.tool().tool()` chaining, which nothing uses today), typed `useCallTool`/`ViewProps` are pure inference over refs the user exports, and typegen is an explicit escape-hatch command only — never part of the dev/build hot path. `resource()`/`prompt()` keep returning `this` until a consumer needs refs. Currently implemented: `tool()`/`resource()`/`prompt()` all return `this`; the `ToolRef` change ships with views. Callback types are plain function types (no bivariance hack); narrow→wide erasure happens at the registry `.set()` boundary via contained casts.

## Phase 1 — basic MCP pieces ✅

Scope: server identity, tools, resources, resource templates, prompts, completion, HTTP serving, inspector shell. Files: `src/server.ts` (MCPServer), `src/mount-mcp.ts` (fetch-native MCP mount), `src/config.ts` (ServerConfig), `src/context.ts` (RequestContext), one file per primitive's types (`src/tools.ts`, `src/resources.ts`, `src/prompts.ts`), `src/completable.ts`, `src/inspector-shell.ts` (CDN shell route — contract in `CLI_SPEC.md`). The bin and toolchain (`src/bin*`, `src/cli/`) are governed by `CLI_SPEC.md`. Callbacks return raw SDK result shapes (see ground rules) — there is no results/conversion layer. Types-plus-tests typecheck runs via `tsconfig.test.json` (`pnpm typecheck`, part of `test:run`); compile-time contracts are pinned by `tests/type-level.test.ts` (`@ts-expect-error` + `expectTypeOf`).

Public API (shape shared with the old package where it happened to be right; deltas noted):

```ts
import { MCPServer, completable } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
  title: "My Server", // optional
  description: "…", // optional; forwarded as implementation metadata
  websiteUrl: "https://example.com/my-server", // optional implementation metadata
  favicon: "brand/favicon.ico", // optional; public/ path, http(s), or image data URL
  icons: [{ src: "brand/icon.svg", mimeType: "image/svg+xml" }], // optional official Icon[]
  instructions: "…", // optional
  basePath: "/mcp", // optional, default "/mcp"
  host: "127.0.0.1", // optional; "0.0.0.0" for public listen()
  allowedHosts: undefined, // optional, e.g. ["api.example.com"]; additive to localhost
  allowedOrigins: undefined, // optional origin hostnames; defaults to the Host allowlist
  legacy: "stateless", // optional; "reject" for modern-only strict (see ground rules)
  publicLandingPage: false, // optional; OAuth-only public HTML opt-in
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
    _meta: { "weather.example/version": 2 },
  },
  async ({ city }, ctx) => {
    const data = { city, temperature: "22°C" };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

server.resource(
  {
    name: "config",
    uri: "config://settings",
    annotations: { audience: ["assistant"], priority: 0.8 },
    _meta: { "config.example/category": "settings" },
  },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: "application/json", text: `{"theme":"dark"}` },
    ],
  }),
);

server.resourceTemplate(
  {
    name: "users",
    uriTemplate: "db://users/{region}/{id}",
    annotations: { audience: ["assistant"] },
    _meta: { "db.example/entity": "user" },
    complete: {
      region: ["us-east", "us-west"],
      id: async (value, context) =>
        listUserIds(context?.arguments?.region).then((ids) =>
          ids.filter((id) => id.startsWith(value))
        ),
    },
  },
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

await server.listen(3000); // Node HTTP (default)
const handler = server.getHandler(); // universal web handler (Vercel, Hono, Workers)
await server.getNodeHandler(); // Node (req, res) for custom http.Server composition
server.basePath; // readonly accessor (default "/mcp") — lets tooling introspect the mount point
server.branding; // immutable normalized favicon/icons/websiteUrl
```

### Mounting in your framework

| Need | API |
|---|---|
| Vercel / Workers / TanStack `{ fetch }` | `export default { fetch: server.getHandler() }` |
| Hono / fetch-native frameworks | `app.all("*", server.getHandler())` — no `c.req.raw` |
| Node (normal) | `await server.listen(port)` |
| Custom `http.Server` | `createServer(await server.getNodeHandler())` |
| Custom HTTP routes | User's framework — not mcp-use |

`getHandler()` duck-types Hono-style `{ req: { raw: Request } }` and accepts a raw `Request`. Custom routes and HTTP middleware live in the user's framework; mcp-use covers MCP-owned routes only. Optional `ServerConfig.cors` adds CORS headers on those routes; pair with `allowedOrigins` for browser clients.

**Handlers vs middleware vs events:** `server.tool()` implements business logic; `server.use('mcp:…')` intercepts with `next()` (mutate params, short-circuit); `server.on('mcp:…')` observes read-only (`:complete` suffix for after-handler). HTTP `server.use(morgan)` is not on `MCPServer` — use your framework.

Definition descriptors use the official SDK contracts directly. `ToolDefinition.annotations` is `ToolAnnotations`; `ResourceDefinition.annotations` and `ResourceTemplateDefinition.annotations` are the general `Annotations` type; all three definitions accept `_meta: MetaObject`. `Annotations`, `ToolAnnotations`, and `MetaObject` are re-exported from `mcp-use`. Annotations are standardized MCP hints with defined fields and semantics. `_meta` is the extension bag: custom keys should be vendor-namespaced so they do not collide with protocol or MCP Apps keys. The registry passes annotations and metadata to the official SDK registration config without changing their values; shallow copies made during per-request replay prevent SDK registration from mutating caller-owned metadata.

Definition `_meta` is advertised only on the corresponding list descriptor: `tools/list`, `resources/list`, or `resources/templates/list`. It is not a result channel. A tool callback's result `_meta` describes one invocation, and a `resources/read` content item's `_meta` describes that content item; neither is populated from definition metadata. View/visibility tools have one registration-boundary exception: framework-owned MCP Apps keys are derived from the declared `view` and `visibility` fields and merged with custom tool definition metadata under the precedence rules in `VIEWS_SPEC.md`; unrelated vendor keys remain intact.

Result model (raw wire shapes; see the no-response-helpers ground rule): tool callbacks return the SDK's `CallToolResult`, resource callbacks `ReadResourceResult` (each `contents` entry addresses itself with the read `uri` and carries its own `mimeType`; the definition's `mimeType` is listing metadata only), prompt callbacks `GetPromptResult` (`description` passes through verbatim — the definition's is not injected). `ToolResult<TOutput>` in `src/tools.ts` encodes the SDK's runtime rule at compile time: tools **without** an `outputSchema` accept any `CallToolResult`; tools **with** one must return `structuredContent` matching the schema's inferred type — any JSON root, per the 2026 wire — or set `isError: true` (the SDK exempts `isError` results from output validation; anything else without `structuredContent` throws at call time).

Callback context (`ctx`, second parameter): `{ signal, request?, client, elicit, inputResponses?, requestState, reportProgress, sendLog, auth? }` — request-scoped only. `ctx.elicit` is the typed form/URL convenience path; `inputResponses` and `requestState()` expose the official v2 multi-round-trip state for advanced flows. The package root re-exports `inputRequired`, `inputResponse`, `acceptedContent`, and `createRequestStateCodec`. `ctx.client` exposes per-request client capabilities (`VIEWS_SPEC.md`), and with OAuth configured, `ctx.auth` is present (`AUTH_SPEC.md` / `AUTH_IMPLEMENTATION.md`). Nothing session-scoped is added.

For the common human-input path, `await ctx.elicit(key, message, schemaOrUrl)` combines correlation and Standard Schema validation. Return `result` when `status === "required"`; accepted form values are inferred from the schema, while decline and cancel remain explicit. Invalid accepted form content produces another `required` result. `ctx.reportProgress(...)` is request-scoped and returns `false` when the caller supplied no progress token.

### Server identity and browser branding

`ServerConfig.websiteUrl?: string` and `ServerConfig.icons?: Icon[]` use the official SDK `Implementation` and `Icon` fields without private `_meta`. `Icon` is re-exported from `mcp-use` and has the canonical shape `{ src: string; mimeType?: string; sizes?: string[]; theme?: "light" | "dark" }`. `websiteUrl` must be a non-empty absolute HTTP(S) URL. `icons` preserves author order on the wire; an empty array is valid and emits `icons: []` while selecting no favicon.

Icon and favicon sources accept exactly three forms: a safe path relative to project `public/`, an absolute HTTP(S) URL, or an `image/*` data URL. Local paths must not start with `/`, contain `..` segments, backslashes, a query, a fragment, or empty path segments. Local icon sources become request-scoped absolute implementation URLs under `<assets-base><basePath>/_mcp-use/public/<encoded-path>` (`basePath: "/"` produces `/_mcp-use/public/…`); HTTP(S) and data sources pass through unchanged. `MCP_ASSETS_URL` and the existing request/proxy origin resolution govern `<assets-base>`, keeping identity metadata aligned with view public assets. Invalid values fail at `MCPServer` construction.

`ServerConfig.favicon?: string` controls the conventional browser route. A present, valid `favicon` always wins. Otherwise a non-empty `icons` list selects the first match in this order: ICO (MIME or URL pathname), PNG declaring `16x16` or `32x32`, any PNG (MIME or URL pathname), then the first icon. URL pathnames are inspected without query strings and MIME declarations participate, a deliberate hardening over v1's case-sensitive `src.endsWith(...)` checks. An empty `icons` array selects nothing. An explicitly empty `favicon` is invalid rather than silently treated as absent.

`GET` and `HEAD /favicon.ico` remain root-level regardless of `basePath`, matching browser discovery and v1. A local source streams the selected file from `public/` in dev/direct use or `.mcp-use/build/views/public/` in production; `mcp-use build` copies `public/` there even for servers without views. An image data URL is decoded and served directly. An HTTP(S) source returns `307` with `Location` and is never fetched server-side. Local/data success uses the selected or extension-derived image MIME, `Cache-Control: public, max-age=31536000, immutable`, and `X-Content-Type-Options: nosniff`; redirects use `public, max-age=300`. Missing local files return `404` with `Cache-Control: no-store`. Unsupported methods return `405` with `Allow: GET, HEAD`. Public-file resolution verifies containment and a regular file after decoding the URL path, rejecting traversal and malformed encodings.

Route order is favicon, public assets, built view assets, inspector, then the exact MCP route; OAuth discovery middleware remains outside this table and the bearer gate still wraps only the exact MCP endpoint. Thus favicon/public assets and `${basePath}/inspector` stay public alongside OAuth metadata. `listen()` and `getHandler()` use the same composed fetch handler. When configured, global `cors` middleware owns the branding responses' CORS headers; otherwise shared view/public assets retain their existing wildcard header. The inspector shell emits `<link rel="icon" href="/favicon.ico">` only when a favicon is selected. The landing page uses the request-resolved absolute `/favicon.ico` URL for both its browser favicon and hero icon. Views obtain server icons and `websiteUrl` through standard MCP initialization metadata; view documents do not invent another branding channel. `MCPServer.branding` exposes the frozen normalized `{ favicon?, icons?, websiteUrl? }` so browser integrations do not duplicate selection or file handling.

**Deltas vs the old package (protocol- or SDK-forced):**

1. `completable(...)` must wrap the _outer_ schema: `.describe()` etc. go on the schema argument (`completable(z.string().describe("…"), values)`), because zod refinements clone the schema and drop the SDK's completion marker. `.optional()` after `completable()` still works (the SDK unwraps optionals).
2. Registrations are rejected after `listen()`/`getHandler()` — the registry is replayed per request, so late registration would be silently inconsistent. (The old package allowed live registration because it kept long-lived per-session servers; that model is gone.)
3. Invalid tool input surfaces as an `isError` tool result (SDK behavior), not a thrown protocol error.
4. Raw SDK result shapes (`{ content }`, `{ contents }`, `{ messages }`) are the **only** result model — the old package's `text()`/`object()`/`array()`/`error()` helpers are gone (see the no-response-helpers ground rule). Follow-on shape changes: resource callbacks receive the read URI (`(uri, ctx)` static, `(uri, params, ctx)` templated) since raw `contents` entries must address themselves; nothing injects a resource `mimeType` or a prompt `description` into results anymore — what the callback returns is what goes on the wire.
5. `listen()` binds `127.0.0.1` by default (old package: `0.0.0.0`) and localhost-class binds get DNS-rebinding protection automatically: `Host` on every request, `Origin` only on non-GET/HEAD (sandboxed view iframes send `Origin: null` on asset GETs; the MCP wire is POST). Validation follows the threat model, not the adapter's host-keyed defaults: DNS rebinding targets locally bound servers, so `getHandler()` — which never binds and is expected to sit behind a platform edge that only routes the deployment's own hostnames — applies **no** validation unless `allowedHosts`/`allowedOrigins` are set, and a public `listen(host: "0.0.0.0")` serves unvalidated with a one-line warning. Configured `allowedHosts`/`allowedOrigins` are **additive** to the localhost allowlists (local runs keep working), and `allowedOrigins` defaults to mirroring the effective Host allowlist. The one guarded footgun: a localhost `listen()` after `getHandler()` already mounted the app without validation throws.
6. `inputSchema`/`outputSchema` accept any Standard Schema validator with JSON Schema support (`StandardSchemaWithJSON`), not just zod (old package: zod peer dep). Tool definitions also accept `schema` as an alias for `inputSchema`. Zod v4 schemas work unchanged; zod is no longer a dependency of this package.
7. Tools declaring an `outputSchema` must return matching `structuredContent` or an `isError: true` result — content-only returns are a **compile-time** error (old package: compiled, then failed at call time in output validation). Not protocol-forced, but the protocol rule made real in types (`ToolResult<TOutput>` over raw `CallToolResult`); `tests/type-level.test.ts` pins it, including non-object schema roots (`z.array(…)`, `z.number()`).
8. `resourceTemplate()` uses a `const` type parameter so `uriTemplate` stays a string literal through inference — without it TS widens object-literal properties to `string` and template-param typing silently degrades to `Record<string, string | string[]>` (it had, undetected, before the type-level tests). Template inference handles RFC 6570 operators, comma-separated variable lists, and `*`/`:n` modifiers.
9. Resource-template completions live in the definition's `complete` map. Literal `uriTemplate` values restrict keys to variables extracted by the same RFC 6570-aware inference used for read params; widened string templates fall back to string keys. A value is either a readonly string array or the official SDK `CompleteResourceTemplateCallback`, so dynamic completion may be synchronous or asynchronous and receives `(currentValue, { arguments?: Record<string, string> })`. Static arrays preserve declaration order and use case-insensitive, untrimmed prefix matching. The SDK owns the protocol result: it truncates `values` to 100, sets `total` to the callback array length, and sets `hasMore` when that length exceeds 100. Missing variable completers return an empty completion, an unknown resource-template URI is an invalid-params error, and callback errors propagate as protocol errors. The SDK does not provide request `ServerContext`, auth, progress, or cancellation to resource-template completion callbacks, so this API does not claim those capabilities. Completions are replayed through the ordinary per-request resource-template registry for both modern and stateless legacy traffic; duplicate names retain the registry's last-registration-wins behavior and registration remains frozen after `listen()`/`getHandler()`.
10. The modern wire is the per-request `_meta` envelope, not a handshake (see the 2026-07-28-first ground rule; 2025-era clients are served through the stateless legacy fallback by default, or rejected under `legacy: "reject"`). The official client connects modern with `versionNegotiation: { mode: { pin: "2026-07-28" } }` (or `'auto'`) — its default is the legacy handshake. Hand-rolled modern requests carry the per-request `_meta` envelope (`protocolVersion`/`clientInfo`/`clientCapabilities` keys) plus `mcp-protocol-version`/`mcp-method` headers, and `mcp-name` mirroring `params.name` on name-addressed methods; modern exchanges answer with a single JSON body (`responseMode: 'auto'`), not SSE framing.

### Browser landing page

The exact MCP `basePath` also serves a generated HTML landing page for browser navigation. A request is a landing-page request only when its method is `GET` or `HEAD` and an `Accept` media range explicitly names `text/html` with a non-zero quality value. `HEAD` returns the same status and headers as `GET` with no body. Requests with JSON, event-stream, wildcard-only, missing, or other Accept values continue to the MCP mount unchanged; in particular, legacy stateless GET/HEAD probes retain their existing `204`, DELETE retains its existing behavior, and every POST remains MCP protocol traffic.

The document preserves the authoritative v1 landing frontend: the WebGL mesh-gradient hero, rail/card layout, Outfit branding, endpoint copy control, hosted Manufact Inspector deep link, GitHub badge, Claude Code/Cursor/VS Code/VS Code Insiders/ChatGPT tabs, optional Primitives card, and Manufact footer. Its automatic server inputs are `title ?? name`, `version`, `description`, the request-resolved public origin plus `basePath`, the normalized selected favicon when present, and the registered tools, prompts, and static resources. CSS, WebGL, tabs, and copy behavior are inline; the v1 Google Fonts stylesheet and GitHub shields image remain external. Every caller-controlled value is encoded for its destination context: HTML text and attributes are entity-escaped, inline JSON preserves raw metadata while escaping HTML end-tag characters, deep-link query values are URL-encoded, and the copyable Claude Code endpoint is a quoted POSIX shell argument. `favicon`, `icons`, and `websiteUrl` follow the server-identity and browser-branding contract above.

Registration data comes from the same registry that `listen()` or `getHandler()` freezes when it first mounts the app. Late registrations throw, so a page can never advertise primitives that the per-request SDK factory cannot replay.

Without OAuth, the landing page is public. With OAuth, it passes through the exact endpoint bearer gate by default. `ServerConfig.publicLandingPage: true` bypasses bearer authentication only for the classified HTML GET/HEAD request; every protocol-shaped request remains protected. The complete auth interaction is specified in `AUTH_SPEC.md`.

`generateLandingPage(options)` is exported from `mcp-use/landing` for applications that need the same document outside `MCPServer`. It takes one `LandingPageOptions` object instead of v1's positional argument list; the object form keeps optional v2 inputs explicit and extensible, and additionally permits an `iconUrl` for its favicon link and hero image. The built-in handler supplies the request-resolved absolute `/favicon.ico` URL whenever normalized branding selected a favicon. `MCPServer` dynamically imports this sibling entry only for classified HTML navigation, so ordinary MCP requests do not evaluate or inflate the page renderer.

**Intentionally absent from the core primitive layer:** legacy push-style sampling/roots APIs, telemetry, typegen, and stdio serving. MCP operation middleware (`server.use('mcp:…')`) and observer events (`server.on('mcp:…')`) are implemented; HTTP middleware adapters and custom first-class HTTP routes are not — use your fetch-native framework. OpenAPI import is an integration built on top of `tool()`, described below; it does not add a second registration path. Views are governed by `VIEWS_SPEC.md`. Typed `ctx.elicit` and the raw v2 MRTR primitives (`inputRequired`, `inputResponse`, `acceptedContent`) operate through explicit `input_required` returns without introducing session state.

**Examples** (`examples/vercel`, `examples/railway`): the two deployment doors, each verified end-to-end. Vercel = serverless via `getHandler()` exported as `export default { fetch }` from an `api/` function — zero host config (delta 5). Railway = the CLI entry contract (`CLI_SPEC.md`): the entry default-exports the server and never calls `listen()` itself; `mcp-use build` + `mcp-use start` own the socket (host selection via `RAILWAY_PUBLIC_DOMAIN` stays constructor config, which `start`'s `listen()` honors), and the bin handles SIGINT/SIGTERM → `close()`.

## OpenAPI integration

`MCPServer.fromOpenAPI(options)` creates an unauthenticated server from a parsed, bundled OpenAPI 3.x document. The server name defaults to `spec.info.title`; its version resolves from `options.version`, then `spec.info.version`, then `"1.0.0"`. Every included operation is registered through the ordinary `tool()` registry, so generated servers retain the same stateless lifecycle and registration freeze as hand-authored servers.

Operation selection matches v1: `tags` is an include-any filter; each `exclude` rule ANDs its populated `operationId`, `path`, `method`, and `tags` criteria; operation-level parameters replace same-location/same-name path parameters. Tool names prefer `operationId`, otherwise derive from method + path, are sanitized to MCP-safe names no longer than 64 characters, and receive deterministic `_2`, `_3`, … suffixes on collision within that limit. Descriptions join the operation summary, description, and `HTTP: METHOD /path` line.

Generated input schemas flatten non-cookie path/query/header parameters and a JSON request body (`body`) into one object. A parameter keeps its OpenAPI name when that name is unique; same-name parameters from different locations use a location suffix such as `_path` or `_query`, and a parameter named `body` is similarly suffixed when a request body reserves that field. Any remaining generated-key collision receives a deterministic numeric suffix. Path parameters are always required. Local bundled references are resolved; schema references are rewritten into JSON Schema `$defs` so recursive schemas remain valid. OpenAPI 3.0 `nullable` becomes a JSON Schema null union. The SDK's `fromJsonSchema` adapter supplies Standard Schema validation and JSON Schema emission, preserving the core package's no-Zod-runtime-dependency rule.

Calls use `options.baseUrl`, then the first `spec.servers` URL; constructing a generated server with operations but neither URL throws a descriptive error. Path values are encoded, array query values repeat the key, headers are mapped directly, and JSON request bodies set `content-type` unless already present. Static headers plus bearer/custom-header upstream authentication are supported. Successful responses containing valid JSON return both a JSON text block and native `structuredContent`; empty or invalid JSON payloads fall back to text, successful non-JSON responses return text, and non-2xx responses return an `isError` text result. External references, cookie parameters, non-JSON request bodies, OpenAPI callbacks/webhooks, and automatic security-scheme credential discovery are intentionally unsupported. A custom `fetch` may be supplied for runtime integration, but tests exercise the default implementation over real HTTP.

`examples/openapi` is the runnable reference: it fetches the National Weather Service document at entry load, selects four read-only weather operations, and default-exports the generated server for the standard `mcp-use dev` / `build` / `start` lifecycle.

## Upstream server composition

`await server.proxy(servers)` composes name-keyed upstream HTTP MCP servers into the static parent registry before `listen()` or `getHandler()`. The server dynamically imports the optional `@mcp-use/client` v2 peer, creates one `MCPClient`, and connects to each configured server independently. Config-map keys automatically namespace capabilities. Connection failures skip that upstream, introspection failures skip only the affected capability kind, and name collisions skip only the colliding capability; every skipped item emits a diagnostic while successfully mountable upstreams and capabilities remain registered.

```ts
await server.proxy({
  weather: { url: "https://weather.example.com/mcp" },
  database: {
    url: "https://database.example.com/mcp",
    authToken: process.env.DATABASE_MCP_TOKEN,
  },
});
```

The automatic namespace prefixes tool, resource, and prompt names with `<namespace>_`. Static resource listing URIs use `mcp-use-proxy:///<encoded namespace>/<encoded upstream URI>` so any namespace is valid and upstream URI schemes cannot collide. Reads forward the original URI. Tool calls preserve raw results (including `isError`, `structuredContent`, `_meta`, and `input_required` where the client supports it), downstream cancellation is passed upstream, and upstream progress is reported through the active downstream request context. A failed downstream progress notification is diagnosed without rejecting the upstream tool call. Input/output JSON Schemas, annotations, titles, and descriptions are advertised from the introspected upstream metadata; validation remains authoritative upstream.

The low-level overload accepts an existing ready connection:

```ts
const connection = await client.connect("database");
await server.proxy(connection);
```

An existing connection's negotiated server name supplies its automatic namespace. Connections created from a config map are owned by the parent and closed by `server.close()`, including when shutdown overlaps an in-flight `proxy()` call. Cleanup waits for every owned client even if one close fails. An explicitly supplied connection remains caller-owned. Calling `proxy()` after the parent starts or closes throws before mounting capabilities. If `@mcp-use/client` is absent, config-map proxying throws with an unversioned npm install command; importing and running a server that never calls `proxy()` does not evaluate or require the client package.

Proxy configuration is HTTP-only and accepts explicit bearer tokens or authentication headers. The public proxy API has no stdio or OAuth options. Internally the server forces client auto-OAuth off, so proxy setup and server startup never open a browser or acquire tokens; applications own credential acquisition and refresh.

The initial v2 surface proxies tools, static resources, and prompts. It does not proxy resource templates, completions, subscriptions, upstream list-change re-synchronization, or legacy push-style sampling/elicitation callbacks.

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
- **Typed against the SDK, exhaustively.** Detail formatting is a table mapped over the SDK's `RequestMethod` union with params typed per method via `RequestTypeMap`; a new protocol method in an SDK bump is a **compile error** here until a formatter is chosen (the v1 logger's silent `[unknown-method]` fallback is the anti-pattern this replaces). Bodies are narrowed with `isJSONRPCRequest`, and the parsed body comes from `getRequestBag(request).parsedBody` when the JSON middleware ran first (no re-parse).
- **Safety.** Credential headers (`authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`) are `[REDACTED]` in trace dumps; request-derived strings (method/subject/client/error) are stripped of control characters so hostile values cannot forge log lines or emit terminal escapes; `subscriptions/listen` responses are never awaited for an outcome (unbounded SSE stream — reading it would block the middleware chain).
- **Colors** via a ~10-line internal ANSI helper — **no chalk/picocolors dependency** (dependency-budget ground rule). Honors `NO_COLOR`; plain text when stdout is not a TTY or absent (edge runtimes).
- **Noise.** Inspector shell page loads and favicon probes (GET/HEAD) are skipped; non-MCP requests log the summary line only.
- **Config & exports.** `logging?: { enabled?: boolean; level?: "info" | "debug" | "trace" }` on `ServerConfig` (default enabled at `info`). On/off-with-options config fields are object-only with an `enabled` flag — no `boolean | object` unions. `requestLogger(options)`, `LoggingOptions`, and `LogLevel` are exported from the package root for hand-composed `createMcpMount` apps.

## Elicitation and input_required

Tool callbacks may return the SDK's raw `InputRequiredResult` in addition to a completed `CallToolResult`, including when the tool declares an `outputSchema`. The package root re-exports the official `inputRequired`, `acceptedContent`, `inputResponse`, and `createRequestStateCodec` helpers and their core result/request types as advanced escape hatches. No mcp-use-specific tool-result wrapper exists.

`RequestContext` exposes `inputResponses`, `requestState()`, and a v1-shaped `elicit` builder:

```ts
server.tool(
  {
    name: "deploy",
    inputSchema: z.object({ environment: z.string() }),
  },
  async ({ environment }, ctx) => {
    const confirmation = await ctx.elicit(
      "confirm",
      `Deploy to ${environment}?`,
      z.object({ confirm: z.boolean() })
    );
    if (confirmation.status === "required") {
      return confirmation.result;
    }
    if (
      confirmation.status !== "accept" ||
      confirmation.data.confirm !== true
    ) {
      return { content: [{ type: "text", text: "Cancelled" }], isError: true };
    }
    return { content: [{ type: "text", text: "Deployed" }] };
  }
);
```

`ctx.elicit(key, message, schema)` handles typed form mode; `ctx.elicit(key, message, url)` handles URL mode. It returns `{ status: "required", result }` on first entry (and after invalid Standard Schema form data), `{ status: "accept", data }` for an accepted typed form, `{ status: "accept" }` for accepted URL mode, or `{ status: "decline" | "cancel" }`. The explicit key correlates the embedded request with the response on retry.

`ctx.elicit` is asynchronous only so Standard Schema validators may be synchronous or asynchronous. It never waits for user input inside the handler: the stateless 2026 protocol still requires the handler to return `input_required`, after which the client retries the original tool. Keeping the `required` return branch explicit makes handler re-entry visible and avoids a hidden suspension mechanism that could make repeated pre-elicitation side effects surprising. URL mode needs no `elicitationId`; correlation is the key, with integrity-protected `requestState` for sequential rounds. No server-side request remains open while the user responds.

`ctx.elicit` validates accepted Standard Schema form content before exposing typed `data`; malformed accepted data produces another `required` result. The raw `inputResponses` collection is still exposed for advanced parallel or mixed-request flows and contains only the current round. Those flows use `acceptedContent` for schema validation and `inputResponse` to distinguish missing / accept / decline / cancel and other embedded request kinds. Sequential flows use `requestState`; `ServerConfig.requestState.verify` passes through to the SDK, and state that influences authorization or business logic must be protected (normally with `createRequestStateCodec`). View result metadata is attached only to completed results, never to intermediate `input_required` returns.

## Later phases (each gets its own scope + delta notes before work starts)

- **Build/dev/start CLI: implemented** — contract in **`CLI_SPEC.md`** (bin + lazily imported toolchain in this package, `.mcp-use/` workspace, inspector CDN shell, entry contract).
- **Views (MCP Apps): implemented** — contract in **`VIEWS_SPEC.md`** (single-protocol MCP Apps with no adapter system, `ToolRef`-based zero-codegen typing, `mcp-use/react` runtime, view naming throughout; extends the CLI contract with a client Vite environment).
- **Serving hardening:** composing into a user's existing fetch-native app (validation middleware guidance) — `createMcpMount` itself is implemented; stdio serving decision (`serveStdio` works off the same factory); expose the underlying `McpServerFactory` (`server.factory()`) so any official adapter can consume it. Plus DX debts found building the examples: (1) `listen()`'s returned `url` is hardcoded to `localhost` — wrong for public binds; (2) no diagnostic when `basePath` drifts from where the handler is actually mounted (silent 404) — warn at `getHandler()` time.
- **Auth: direct resource-server mode implemented; proxy mode deferred.** Contract in **`AUTH_SPEC.md`** / **`AUTH_IMPLEMENTATION.md`** (resource-server posture, `ctx.auth`, `bearerAuth`/`oauthMetadata`, provider adapters, RFC 9728 metadata). OAuth proxy mode (local authorization server) remains deferred.
- **Product shell:** OAuth providers + scope guards + `.well-known` (with auth, above), operation middleware (`server.use("mcp:*")`) and observer events (`server.on("mcp:*")`), optional `ServerConfig.cors`, the browser landing page, and resource-subscription ergonomics are implemented. Cross-request v2 list/resource notifications are implemented through `MCPServer.notify*`, backed by the SDK handler bus. Every per-request SDK server advertises tool/prompt/resource `listChanged` (and resource `subscribe`) even while a registry is empty, so a client connected before the first primitive is added can subscribe. `getHandler({ bus })` accepts an SDK `ServerEventBus` for entries that need several handler instances to share open subscriptions; `mcp-use dev` uses one process-scoped bus across every reload generation and publishes all three list invalidations after a successful handler swap.
- **Elicitation & context:** MRTR state, typed form and URL elicitation, progress, and logging helpers are implemented. Push-style sampling/roots remain legacy-only and are deprecated in the 2026-07-28 spec.
- **Integration:** OpenAPI import and upstream server composition are implemented. Telemetry (posthog-node, opt-out) remains deferred. The independently published `@mcp-use/client` remains the SDK boundary; the framework consumes it on demand for `server.proxy()` and `mcp-use client` rather than folding or re-exporting the SDK from the server runtime.

## Open questions (answered per phase, not up front)

- Sampling/roots: omit at v2.0 vs `@deprecated` legacy support (elicitation & context phase).
- `posthog-node`: hard dep with opt-out vs optional (cutover phase).
