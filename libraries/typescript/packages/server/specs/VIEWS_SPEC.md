# @mcp-use/server — Views (MCP Apps) spec

**Status:** Design contract, pre-implementation. Companion to `SPEC.md`; this document **supersedes** the `SPEC.md` Phase-5 sketch ("dual-protocol adapters, … typegen") and the typed-hooks posture inside the "No return-type accumulation" ground rule. Where the two disagree, this document wins.
**Scope:** the views runtime in the server package, view resources and protocol metadata, the React view runtime (`/react` subpath), the zero-codegen typing layer (`ToolRef` / `Register`), and the views half of the `dev`/`build`/`start` contract (base contract in `CLI_SPEC.md`).
**Tracking:** Linear MCP-2601 (Views & MCP Apps + typing days), MCP-2180 (widget→view naming).
**v1 reference:** `packages/mcp-use` (`src/react/`, `src/server/widgets/`) defines *what* views must be able to do, never how. Parity with v1 is the alpha goal; the architecture is not carried over.

## Decisions at a glance

1. **One protocol: MCP Apps.** The [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) (`io.modelcontextprotocol/ui`, spec `2026-01-26` + draft) is the only wire format. The v1 adapter system (`AppsSdkAdapter`, dual-protocol metadata, `window.openai` transport) is **not ported**.
2. **Public naming is "view", everywhere.** `view` tool config, `view()` helper, `useView` hook, `viewsDir`, `ui://views/…`. "Widget" survives nowhere in the v2 API.
3. **`tool()` returns `ToolRef<Name, Input, Output>`** (not `this`). Typed `useCallTool` is pure type inference over exported refs — zero codegen, nothing generated on the dev/build hot path.
4. **Props flow like normal React props** (decided 2026-07-06). The runtime owns the iframe mount, so it renders `<View {...props} />` itself: the handler's `view({ props })` payload *is* the component's props — no hook pull, no v1 `toolInput`+`structuredContent` merge. An optional `Loading` export covers the no-props-yet window; hooks shrink to genuinely ambient concerns (host context, actions, tool input/streaming).
5. **The React runtime builds on `@modelcontextprotocol/ext-apps`** (guest `App` class); the server package **inlines** the few wire constants and emits spec `_meta` itself — no ext-apps import server-side.
6. **`view()` is the one response helper.** The no-response-helpers ground rule stands for everything else; `view()` earns its exception (rationale below).
7. **React runtime ships as the `/react` subpath** of this package (answers the `SPEC.md` open question), with `react` an optional peer — tool-only servers never pay for it.
8. **Parity with v1 hooks, minus two named gaps** (file upload, cross-session view state) that the MCP Apps spec cannot express — see "Dropped from v1".

---

## Protocol posture

### Why no adapters

ChatGPT natively implements the MCP Apps bridge and metadata ([OpenAI: MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)) — their guidance is "build with the standard by default; `window.openai` only for ChatGPT-specific extensions". Every host we target (ChatGPT, Claude, our inspector) speaks the standard, so the v1 dual-emission machinery buys nothing. If a host ever requires an `openai/*` (or other vendor) overlay, it re-enters as a pure metadata transform at the registration boundary — an additive change with no architectural cost, deferred deliberately.

`window.openai` extensions (checkout, modals, file pickers) are likewise out of scope for the alpha. Views that need them can feature-detect the global themselves; the runtime neither wraps nor depends on it.

### Spec target

We track the ext-apps **draft** spec (the SDK is beta; the draft adds `ui/download-file`, sampling, and the `message`/`updateModelContext` host-capability declarations) while emitting the stable `2026-01-26` protocol version constant, matching what ext-apps `1.7.4` itself does. Not everything in the spec is implemented for the alpha — the surface is driven by v1 parity (see the hook table), not spec completeness.

### Wire metadata

Emitted by this package (constants inlined; names are the spec's):


| Where            | Key                                                         | Value                                                        |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| tool `_meta`     | `ui.resourceUri`                                            | `ui://views/<view-name>.html`                                |
| tool `_meta`     | `"ui/resourceUri"`                                          | same value (legacy flat key, kept while hosts still read it) |
| tool `_meta`     | `ui.visibility`                                             | `["model"]` / `["app"]` when the view config narrows it      |
| resource         | `mimeType`                                                  | `text/html;profile=mcp-app`                                  |
| resource `_meta` | `ui.csp`, `ui.permissions`, `ui.domain`, `ui.prefersBorder` | from the view's `metadata` export                            |


Security metadata (CSP, permissions) lives on the **resource**, never the tool — hosts ignore tool-level copies per spec.

### Capability gating (stateless-first)

Per the `SPEC.md` stateless ground rules, UI support is a **request-scoped** fact: the 2026-07-28 wire carries `clientCapabilities` in per-request `_meta`, and MCP Apps support is `capabilities.extensions["io.modelcontextprotocol/ui"]` advertising `mimeTypes: ["text/html;profile=mcp-app"]`. `tools/list` and `resources/list` responses may vary on that request-scoped capability (e.g. omitting `ui.*` meta, hiding app-only tools from non-UI hosts); nothing is ever inferred from remembered sessions. Tools with views always return meaningful `content` so text-only hosts degrade gracefully (spec SHOULD).

The framework does the list-time gating itself; the user-facing surface is one request-context query, `ctx.client.supportsViews()` (the `RequestContext` growth point `SPEC.md` reserves per phase — reads per-request capabilities, never session state):

```ts
server.tool(
  { name: "search-fruits", schema, outputSchema: resultsSchema, view: { name: "product-search-result" } },
  async ({ query }, ctx) => {
    const results = await search(query);
    if (!ctx.client.supportsViews()) {
      // materially different output for text-only hosts (optional — see note)
      return { content: [{ type: "text", text: renderAsMarkdownTable(results) }], structuredContent: results };
    }
    return view({ props: results, content: `Found ${results.items.length} fruits` });
  }
);
```

Note the branch is *optional*: a `view()` result already degrades on text-only hosts (its `content` is present; the `ui.*` meta is ignored). `ctx.client.supportsViews()` exists for when the two audiences deserve materially different output, not as a required ritual.

### ext-apps dependency posture

Verified 2026-07-06: no published ext-apps version supports the v2 SDK — latest `1.7.4` peer-depends on `@modelcontextprotocol/sdk@^1.29.0` (v1); the upstream v2-port PRs (#612, #614) were closed unmerged in favor of a not-yet-landed "SDK divorce" (vendoring the `Protocol` shim and types). Consequences:

- **Server side: write our own — deliberately, and it is small.** Ext-apps' server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`) take a v1 `McpServer` we don't have, and they were always thin sugar over registration this framework does itself. Our replacement: inlined wire constants (mimetype, `_meta.ui.*` keys, extension ID), `_meta` emission at tool/resource registration, and a `getUiCapability` equivalent over per-request `extensions["io.modelcontextprotocol/ui"]` — on the order of 100–200 lines plus pure type definitions vendored from ext-apps `spec.types.ts` (with attribution). Satisfies MCP-2601's "inline constants when sufficient"; the "no v1 SDK imports" ground rule is preserved.
- **View side: reuse essentially the whole guest protocol stack.** The React runtime wraps ext-apps' `App` + `PostMessageTransport`: handshake, capability negotiation, the event system with one-shot replay, all outbound methods (`callServerTool`, `sendMessage`, `openLink`, `requestDisplayMode`, `updateModelContext`, `sendLog`, `downloadFile`, size-changed/auto-resize, teardown), the complete app-tools implementation (`registerTool` — see View tools), style helpers, and the `McpUi*` types. The v1-SDK incompatibility does not bite here: the view never speaks the MCP wire — it speaks apps-spec postMessage to the *host* — so the v1 SDK inside is internal plumbing (`Protocol` base class, types, zod) that Vite tree-shakes into the view's **static browser assets** (the SDK's express/hono/ajv tree is unreachable from `app.ts`). A 1.7.4-based view works against a 2026-07-28 server. Our `/react` code is product surface only — hooks, props-injection wrapper, typing layer, dev overlay — no protocol code.
- **Host side (inspector, test harness): reuse `AppBridge` with `client: null`** — its explicit escape hatch for hosts without a v1 `Client`; request handlers (`oncalltool`, `onlistresources`, …) forward to the v2 client stack manually.
- **Dependency mechanics:** ext-apps (1.4 MB, one hard dep) is an **optional peer** of this package — the `vite` pattern from `CLI_SPEC.md`. View projects declare it (template does); tool-only servers install neither it nor its v1-SDK peer tree (~4.3 MB + express/hono/ajv/jose transitives), keeping the install-budget ground rule honest. Fallback if peer noise warrants: ext-apps' `app-with-deps`/`react-with-deps` bundled entries (cost: zod dedupe). When upstream's SDK divorce lands, the peer disappears and bundles shrink with no API change on our side.

---

## Server API

### File-based views (the first-class authoring path)

View components live under `viewsDir` (default `resources/`), one directory per view, `view.tsx` as the component entry:

```
resources/
  product-search-result/
    view.tsx        # default-exports the component; named-exports viewMetadata
    types.ts
```

```tsx
// resources/product-search-result/view.tsx
import type { ViewMetadata, ViewProps } from "@mcp-use/server/react";

export const metadata: ViewMetadata = {
  description: "Product search results grid",
  csp: { connectDomains: [], resourceDomains: ["https://images.example.com"] },
  prefersBorder: true,
};

export function Loading() {
  return <Skeleton />;   // optional; rendered until the first tool result arrives
}

export default function ProductSearchResult({ query, results }: ViewProps<"search-fruits">) {
  return <ResultsGrid query={query} results={results} />;
}
```

A view file has three recognized exports, two of them borrowed from conventions agents already know (Next.js `metadata` / `loading.tsx`): the **default export** (the component, receiving props — see Props model below), **`metadata`** (`ViewMetadata`: description, csp, permissions, domain, prefersBorder — resource-level facts only; the v1 requirement to hand-declare a zod `props` schema is gone, props types flow from `outputSchema`), and optional **`Loading`** (rendered while no props exist).

Discovery registers one `ui://views/<dir-name>.html` resource per view. The **build/dev manifest is the source of truth** for what views exist and what asset each serves (MCP-2601) — production never rediscovers the filesystem, and nothing depends on `handler.toString()`.

Inline JSX returned from tool handlers is the documented **stretch** authoring model (MCP-2601 "Optional / stretch goals") and is out of this contract; it must layer on the file-based path without changing it.

### Binding a tool to a view

```ts
export const searchFruits = server.tool(
  {
    name: "search-fruits",
    schema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: { name: "product-search-result" },   // v1: `widget: { name }`
  },
  async ({ query }) => view({ props: { /* resultsSchema-shaped */ }, content: `Found …` })
);
```

`view.name` must match a discovered view directory; the mismatch is a startup error (dev) / build error, never a silent broken `resourceUri`. Optional `view.visibility: "model" | "app"` maps to `_meta.ui.visibility`. The v1 `invoking`/`invoked` strings and `widgetAccessible` flag are `openai/*` overlay concepts with no spec equivalent — dropped from the alpha config (space reserved in a future overlay, not here).

**Why `view:` stays `{ name, visibility }` and metadata stays in the view file** (considered and decided 2026-07-06): the dividing rule is *component facts vs relationship facts*. CSP/permissions/domain/prefersBorder/description describe the component — they ship as **resource** `_meta.ui.*` (hosts ignore tool-level copies per spec), they change in lockstep with the component's code (add a CDN fetch → CSP edit in the same file, which agents won't forget), and they must exist even for views no tool binds (app-only views read via `resources/read`). Tools and views are many-to-one, so per-tool metadata would need conflict rules the resource shape doesn't have. `view:` carries only the relationship facts: which view, and the tool's model/app visibility. Per-tool presentation strings (e.g. a future `invoking`/`invoked` overlay) would belong in `view:` by the same rule.

### The `view()` helper — the one exception to "no response helpers"

The no-helpers rationale (`SPEC.md`, 2026-07-01) was that `text()`/`object()`/`array()` were pure dialect over shapes models already know. `view()` is not dialect: it names the three result channels — which differ in *who sees them*, the thing the raw shape makes easy to get wrong. It returns a plain `CallToolResult`; handlers may still hand-build one.

```ts
function view<TOutput>(args: {
  props: TOutput;                       // → structuredContent — model AND view (typed by outputSchema)
  content?: string | ContentBlock[];    // → content — model + text-only hosts (spec-mandated fallback)
  meta?: Record<string, unknown>;       // → _meta — view ONLY; never enters model context
}): CallToolResult;
```

`view()` and the component are two ends of one call: `view({ props })` is conceptually "render the bound component with these props" — the runtime spreads exactly that payload onto the default export (Props model, below). The server side compile-checks `props` against `outputSchema` via `ToolRef`; the view side types its parameters from the same schema via `ViewProps<Name>` — both ends check against one type, so they cannot drift.

### Channel visibility: what the model sees vs what the view sees

The full `CallToolResult` reaches the view (the host forwards it via `ui/notifications/tool-result`); what reaches the **model** is host policy, but the spec's design assumption — and ChatGPT's behavior — is: `content` and `structuredContent` are model-facing, `_meta` is not. Design for that split; never put secrets in any tool result channel (the view is still client-side).

| Data | Model | View | Text-only host | Carried as |
| --- | --- | --- | --- | --- |
| `props` | ✅ | ✅ (component props) | host may render raw | `structuredContent`, typed by `outputSchema` |
| `content` | ✅ | ✅ (rarely read) | ✅ (the fallback) | `content` blocks |
| `meta` | ❌ | ✅ (`useView().meta`) | ❌ (ignored) | result `_meta` |
| tool input | ✅ (it authored it) | ✅ (`useView().toolInput`, streamed) | ✅ | `tools/call` arguments |
| view→model context | ✅ (subsequent turns) | source | n/a | `ui/update-model-context` / `ModelContext` |
| view-tool result | ✅ (it called the tool) | source | n/a | `tools/call` over the bridge → `useViewTool` handler |

Consequences worth spelling out in docs:

- **`props` are model-visible.** That is a feature — the model reasons over exactly what the user is looking at — but it prices props in tokens and rules them out for bulk payloads. The dividing question for every field: *should the model see this?* Yes → `props`; no (bulk, presentation-only, e.g. base64 images, geometry, full result sets beyond what's discussed) → `meta`.
- **`content` is the model/text-host narrative** ("Found 12 results, top match …"). Default when omitted: a JSON text block of `props` (satisfies the spec's meaningful-content SHOULD) — but since `props` are already model-visible as `structuredContent`, the default *duplicates tokens*; handlers should pass a short summary. The docs lead with an explicit `content`.
- **`meta` is the view-only channel** (v1's `widget({ metadata })`, kept): passed through into result `_meta` untouched, read via `useView().meta`, never typed by `outputSchema`, never model context. Not to be confused with the view file's `metadata` export (resource facts: CSP etc.) — different layer entirely.
- The reverse direction is explicit, not ambient: nothing a user does *inside* the view reaches the model unless sent via `ModelContext`/`updateModelContext` (model context push, no follow-up turn) or `sendFollowUpMessage` (`ui/message`, triggers a turn).

### URI scheme and serving

- Resource URI: `ui://views/<name>.html` — stable across builds. (v1 embedded a `buildId` for ChatGPT's per-URI caching; that is an overlay concern. If host caching demonstrably requires it, a content-hash suffix comes back via the manifest — decision deferred to implementation evidence, noted in Open questions.)
- The resource body is a self-contained HTML document loading the view's built assets. Dev serves through the Vite client environment; production serves prebuilt files from `.mcp-use/build/views/` per the manifest. Base-path/asset-URL wiring follows `CLI_SPEC.md`'s workspace layout.

### Wire shape (reference — what our registration layer emits)

The concrete output of the "write our own server helpers" decision (ext-apps posture, above). For the `search-fruits` + `product-search-result` example, `tools/list` carries:

```jsonc
{
  "name": "search-fruits",
  "inputSchema": { /* JSON Schema converted from `schema` */ },
  "outputSchema": { /* converted from `outputSchema` */ },
  "_meta": {
    "ui": { "resourceUri": "ui://views/product-search-result.html" },
    "ui/resourceUri": "ui://views/product-search-result.html"   // legacy flat key, kept while hosts read it
  }
}
```

and `resources/list` / `resources/read` carry (metadata from the view file's `metadata` export, via the manifest):

```jsonc
{
  "uri": "ui://views/product-search-result.html",
  "name": "product-search-result",
  "description": "Product search results grid",
  "mimeType": "text/html;profile=mcp-app",
  "_meta": {
    "ui": {
      "csp": { "connectDomains": [], "resourceDomains": ["https://images.example.com"] },
      "prefersBorder": true
    }
  }
}
```

`resources/read` returns the same fields with the self-contained HTML document as `text`. Requests from clients without the UI extension get these entries with `ui.*` meta omitted (and `visibility: "app"` tools hidden) — the request-scoped gating above.

---

## Typing: `ToolRef` + `Register` (zero codegen)

Decided against the alternatives in `type_proposals.md` (kept as the decision record): exports-based inference ("Proposal A"), with typegen demoted to an explicit escape hatch ("Proposal C" machinery, never on the hot path). MCP-2601 states the same: "`server.tool()` returns `ToolRef<Name, Input, Output>`; generated registry types are an explicit secondary mode only."

### `tool()` return-type change

`tool()` returns `ToolRef<Name, Input, Output>` instead of `this` — a value (`{ name }` at runtime) carrying phantom types read off the existing `InferToolInput`/`InferToolOutput` machinery in `src/tools.ts`. Standard Schema does the inference, so typed views work with zod v4, ArkType, and Valibot alike. Requires a `const` type parameter (`tool<const T extends ToolDefinition>`) so `name` infers as a literal.

This ends `server.tool(…).tool(…)` chaining — an acceptable break: chaining without type accumulation was convenience only, the accumulation version stays rejected (unchanged ground rule — `MCPServer` remains non-generic; `resource()`/`prompt()` keep returning `this` until a consumer needs refs), and the official v2 SDK itself returns a handle from `registerTool`.

### How types reach view files

Widget bundles must never contain server code, so the ref **value** is never imported by a view. The type crosses in type space only:

```ts
// .mcp-use/register.d.ts — constant content, committed, never regenerated
// (the vite-env.d.ts pattern: configuration, not codegen)
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("../src/index");
  }
}
```

```ts
// in /react
export interface Register {}  // filled (or not) by the project's register.d.ts

type ToolsFromModule<M> = {
  [K in keyof M as M[K] extends ToolRef<infer N, any, any> ? N : never]:
    M[K] extends ToolRef<any, infer I, infer O> ? { input: I; output: O } : never;
};
```

Users export the refs of view-callable tools (`export const searchFruits = server.tool(…)`) — the module is the registry; no map API, no `export type AppType` ritual, no user-written `declare module`. `typeof import()` is a live tsserver edge: add a tool, and every view's `useCallTool` union updates with no process running. Multi-file registration composes via re-exports (`export * from "./tools/fruits.js"`).

**Note for cutover:** the `declare module` specifier must match the published import path — it becomes `"mcp-use/react"` when the package renames. The scaffolded file is the only thing that changes.

### Fallback ladder

1. `useCallTool("name")` — primary; typed via `Register` when the project has `register.d.ts` and the ref is exported.
2. `useCallTool(toolRef)` — for contexts where the ref value is legitimately in scope (the inline-JSX stretch path); not for file-based views (value import = server code in the bundle).
3. `useCallTool<Args, Result>("name")` — explicit generics for dynamically registered tools (statically untypeable in any framework) and unexported refs.
4. Empty `Register` (no `register.d.ts`) degrades to `(name: string)` — non-scaffolded projects compile untouched.

A forgotten `export const` silently drops that one tool to rung 3/4 — documented habit; a lint rule is a possible follow-up, not alpha scope.

### Typegen, demoted

Nothing generates types during `dev`, `build`, or `start` — v1's run-the-server generator (`tool-registry-generator.ts`, `zod-to-ts.ts`) is not ported. `mcp-use typegen` (+ `mcp-use check` for CI freshness) is the explicit secondary mode per MCP-2601, for consumers with no compile-time path to the server source; if/when built, it is a TS-checker-based static extractor (reads resolved `ToolRef` types; never executes user code), defaulting output to `.mcp-use/generated/`. Not an alpha deliverable.

Since v2 `create-mcp-use-app` templates don't exist yet, the handwritten example in this package (planned `examples/views`) is the reference for the `register.d.ts` + exported-refs pattern.

---

## React runtime (`/react` subpath)

`@mcp-use/server/react` (→ `mcp-use/react` at cutover). Browser-only code built on the ext-apps guest `App` (one instance per iframe, connected once via `PostMessageTransport`); `react` and `react-dom` are optional peers; importing the subpath from server code is unsupported. The v1 hook *surface* is kept (renamed); the v1 transport guts (three-provider selection, `window.openai` branch, hand-rolled `McpAppsBridge`) are not.

### Props model (decided 2026-07-06)

The generated iframe entry — not user code — subscribes to the bridge and renders the view, so data arrives as **normal React props**:

- **`props` = the `view({ props })` payload, exactly.** The runtime spreads the tool result's `structuredContent` onto the default export. No hook pull required, and no v1-style merge of `toolInput` into props (that merge was a ChatGPT-ism — widgets rendering before results existed). Tool input remains available via `useView().toolInput`; the view-only `meta` channel via `useView().meta` (see Channel visibility).
- **Before the first tool result there are no props**: the wrapper renders the optional `Loading` export instead; absent that, nothing. This replaces v1's in-component `isPending` branching. `Loading` receives the streaming state as *its* props — see Streaming, below.
- **Later tool results re-render with new props** — ordinary React update semantics, nothing bespoke.
- **Typing:** `ViewProps<"tool-name">` resolves the bound tool's `outputSchema` type through the same `Register` machinery as `useCallTool` — the server end (`view()` vs `ToolRef`) and the view end check against one type. Hand-written interfaces also work; props are structurally just the payload.
- **Views not bound to a tool** (app-only/standalone) receive `{}` — such components declare no required props.
- Escape hatches for migration and deep children: `useView().props` and `useViewProps()` return the same payload.

### Streaming (decided 2026-07-06)

Two distinct things can stream, and only one of them exists on the wire today:

**1. Tool *arguments* stream — supported** (spec: `ui/notifications/tool-input-partial`). Hosts deliver progressively parsed arguments while the model is still generating the call — the pre-result window, which is exactly `Loading`'s territory. The wrapper passes the stream in as `Loading`'s props, typed from the tool's **input** schema:

```tsx
export function Loading({ partialInput, isStreaming }: LoadingProps<"search-fruits">) {
  return <SearchSkeleton query={partialInput?.query} />;
}
```

`LoadingProps<Name>` = `{ partialInput?: DeepPartial<Input>; isStreaming: boolean }` — deep-partial because streamed JSON is incomplete by nature (objects missing fields, string values possibly truncated mid-token: treat as provisional, render-only, never act on them). `useView().partialToolInput` exposes the same stream for components that stay mounted across the transition. Note the deliberate type-source flip: `Loading` types from the tool's `schema` (input), the default export from its `outputSchema` (props) — both read off the same `ToolRef`.

**2. Tool *results* do not stream — wire fact, honest alpha posture.** The 2026-07-28 protocol and the apps spec deliver exactly one `ui/notifications/tool-result` per call: there is no partial-`structuredContent` channel, so "streaming props from the handler" (generator-style callbacks yielding progressive results) is not expressible and is **not** faked in the framework (no polling/chunking shims — the no-fallback-first ground rule). Progressive UIs *pull* instead: the view calls app-visible tools via `useCallTool` and owns that state locally (those results return to the caller; they do not become new props). If the protocol later grows partial tool results, they map onto the props model as ordinary re-renders — same channel, more deliveries, no API change; tracked in Open questions.

### View tools (`useViewTool`, decided 2026-07-06)

The apps spec lets the *view* expose tools the **host/model** calls while the view is displayed (ext-apps `App.registerTool` → `RegisteredAppTool`, WebMCP-style; Linear MCP-2309). This is the third tool flavor — keep the taxonomy straight:

| Flavor | Registered by | Called by | Lifetime |
| --- | --- | --- | --- |
| server tool | `server.tool()` | model (via host) | server process |
| server tool, app-visible | `server.tool({ view: { visibility: "app" } })` | the view, via `useCallTool` | server process; hidden from the model |
| **view tool** | `useViewTool` inside the component | host/model over the bridge | while the component is mounted |

View tools are ephemeral, conversational UI affordances whose handlers close over live React state ("highlight-fruit", "pan-map"). The hook mirrors `server.tool(definition, callback)` — same config keys (`name`, `title`, `description`, `schema`, `outputSchema`, `annotations`, plus `enabled`), `schema` translated to ext-apps `inputSchema` internally, handler args inferred via Standard Schema, return typed by the same `ToolResult<Output>` conditional as server tools (raw `CallToolResult`; `view()` is server-handler-side only):

```tsx
const [selected, setSelected] = useState<string | null>(null);

useViewTool(
  { name: "highlight-fruit", description: "Highlight a visible result", schema: z.object({ id: z.string() }) },
  async ({ id }) => {
    setSelected(id);
    return { content: [{ type: "text", text: `Highlighted ${id}` }] };
  }
);
```

Contract:

- **React lifecycle = tool lifecycle.** Register on mount, `remove()` on unmount, `update()` on config change, `enabled: false` → `disable()` without unmounting; ext-apps emits `tools/list_changed` automatically, so the host's tool list always matches the mounted UI (strict-mode double-mount is safe: remove + re-register).
- **Latest-closure handler:** the registered callback delegates through a per-render ref (`useEffectEvent` pattern) — handlers always see current state, no re-registration per render.
- **Connect-time capability:** ext-apps only auto-advertises the `tools` capability for pre-connect registrations, and hooks run post-connect — so the generated iframe entry always declares `tools: { listChanged: true }`. Harmless for views with no tools (empty list).
- **Not in `Register`:** view tools never appear on the server's `tools/list` and are never callable from views — typing them into `useCallTool` would advertise calls nobody can make. Their input/output types live and die inside the component.
- **Progressive enhancement only:** no host capability promises app-tool support; hosts that support it list/call, others ignore. Registration is unconditional and cheap; views must not depend on view tools being invoked.
- **Channel note:** a view tool's result (`content`/`structuredContent`) flows host→model — the third explicit view→model channel (alongside `updateModelContext` and `ui/message`), distinguished by being *model-initiated*.

### Putting it together — a complete view file

Reference sketch exercising the full surface (the `examples/views` example follows this shape):

```tsx
// resources/product-search-result/view.tsx
import { useState } from "react";
import { z } from "zod";
import { ModelContext, useCallTool, useView, useViewState, useViewTool } from "@mcp-use/server/react";
import type { LoadingProps, ViewMetadata, ViewProps } from "@mcp-use/server/react";

export const metadata: ViewMetadata = {
  description: "Product search results grid",
  csp: { connectDomains: [], resourceDomains: ["https://images.example.com"] },
  prefersBorder: true,
};

export function Loading({ partialInput, isStreaming }: LoadingProps<"search-fruits">) {
  return <SearchSkeleton query={partialInput?.query} pulsing={isStreaming} />;
}

export default function ProductSearchResult({ query, results }: ViewProps<"search-fruits">) {
  // ambient host context + actions — hook territory
  const { theme, displayMode, requestDisplayMode, sendFollowUpMessage, openExternal } = useView();

  // local UI state (iframe lifetime; not model-visible, not host-persisted)
  const [favorites, setFavorites] = useViewState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // server tool call from the view — name union + args/result typed via Register
  const details = useCallTool("get-fruit-details");

  // view tool — the model can manipulate this UI while it is on screen
  useViewTool(
    { name: "highlight-fruit", description: "Highlight a visible result", schema: z.object({ id: z.string() }) },
    async ({ id }) => {
      setSelected(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  return (
    <div data-theme={theme}>
      {/* explicit model visibility — the only ambient view→model path */}
      <ModelContext content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`} />

      <ResultsGrid
        results={results}
        selected={selected}
        onFavorite={(id) => setFavorites([...favorites, id])}
        onDetails={(fruit) => details.callTool({ fruit })}   // typed args
        onOpenProducer={(url) => openExternal({ url })}
      />

      {details.isPending && <Spinner />}
      {details.data && <DetailsCard data={details.data.structuredContent} />} {/* typed result */}

      {displayMode === "inline" && (
        <button onClick={() => requestDisplayMode({ mode: "fullscreen" })}>Expand</button>
      )}
      <button onClick={() => sendFollowUpMessage({ prompt: "Compare my favorite fruits" })}>
        Compare favorites
      </button>
    </div>
  );
}
```

Everything data-shaped enters through props (typed by the server's `outputSchema`); everything ambient or imperative goes through hooks; the two view→model paths (`ModelContext`, `sendFollowUpMessage`) are visible and explicit in the JSX. For tools not in the `Register` (dynamic registration, unexported refs), the explicit-generics rung applies: `useCallTool<{ fruit: string }, FruitDetails>("get-fruit-details")`.

### Hook surface (v1 → v2 → backing primitive)


| v1                                                                                                      | v2                                                                                        | Backed by                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useWidget()`                                                                                           | `useView()`                                                                               | `App` events + `getHostContext()`                                            |
| — `props` / `toolInput` / `output`                                                                      | kept (`props` = `view()` payload only — see Props model; primary path is component props) | `ontoolinput` / `ontoolresult`                                               |
| — `metadata`                                                                                            | `meta` — the view-only result channel (never model-visible)                               | result `_meta` from `ontoolresult`                                           |
| — `partialToolInput` / `isStreaming`                                                                    | same                                                                                      | `ontoolinputpartial`                                                         |
| — `isPending`                                                                                           | kept (primary path is the `Loading` export)                                               | input-received-but-no-result state                                           |
| — `theme` / `locale` / `timeZone` / `userAgent` / `displayMode` / `safeArea` / `maxHeight` / `maxWidth` | same                                                                                      | `hostContext` + `onhostcontextchanged`                                       |
| — `callTool`                                                                                            | same                                                                                      | `App.callServerTool`                                                         |
| — `sendFollowUpMessage`                                                                                 | same                                                                                      | `App.sendMessage` (`ui/message`)                                             |
| — `openExternal`                                                                                        | same                                                                                      | `App.openLink`                                                               |
| — `requestDisplayMode`                                                                                  | same                                                                                      | `App.requestDisplayMode`                                                     |
| — `hostInfo` / `hostCapabilities` / `hostContext` / `isAvailable`                                       | same                                                                                      | `getHostVersion` / `getHostCapabilities` / `getHostContext`                  |
| `useWidgetProps()`                                                                                      | `useViewProps()` — migration escape hatch; primary path is component props                | thin wrapper                                                                 |
| `useWidgetState()`                                                                                      | `useViewState()`                                                                          | local state only — see semantics change below                                |
| `useWidgetTheme()`                                                                                      | `useViewTheme()`                                                                          | dedicated `hostcontextchanged` subscription (not a full-`useView` rerender)  |
| `useCallTool(name | ref)`                                                                               | kept, typed via `Register`/`ToolRef`                                                      | `App.callServerTool`                                                         |
| *(no v1 equivalent)*                                                                                    | `useViewTool()` — view-registered tools the host/model calls (see View tools)             | `App.registerTool` + `tools/list_changed`                                    |
| `<McpUseProvider>`                                                                                      | kept                                                                                      | auto-resize via `App`'s built-in `autoResize`; theme; error boundary         |
| `<ThemeProvider>`                                                                                       | kept                                                                                      | ext-apps `applyDocumentTheme` / `applyHostStyleVariables` / `applyHostFonts` |
| `<WidgetControls>`                                                                                      | `<ViewControls>`                                                                          | dev-only overlay, ported                                                     |
| `<ModelContext>` / `modelContext`                                                                       | kept                                                                                      | `App.updateModelContext` (`ui/update-model-context`)                         |
| `<ErrorBoundary>`, `<Image>`                                                                            | kept                                                                                      | unchanged                                                                    |
| `generateHelpers()`                                                                                     | dropped                                                                                   | subsumed by `Register` typing                                                |


### Dropped from v1 (spec gaps, decided 2026-07-06)

- **`useFiles()` (upload):** file upload does not exist in MCP Apps (upstream: "not yet implemented"); it is a ChatGPT-only `window.openai` extension. Dropped from the alpha; host-mediated *download* (`ui/download-file`, draft) may land later.
- **Cross-session view state:** `window.openai.setWidgetState`'s host-persisted-and-restored state has no spec equivalent. `useViewState` becomes honest **local state** (lives for the iframe's lifetime). Model visibility is a separate, explicit act via `ModelContext`/`updateModelContext` — v1's conflation of "UI state" and "model context" in one `setState` is deliberately split.
- **`_meta.openai/*` emission** (`outputTemplate`, `widgetCSP`, invocation strings, …): overlay territory, out of the alpha (see Protocol posture).

---

## CLI integration

Extends `CLI_SPEC.md` (which scoped views out); its ground rules hold — reload-not-HMR, `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk.

- **`mcp-use dev`:** adds a Vite client environment for `viewsDir`; view resources serve through it. View-file edits get Vite's own HMR (pure client code); server-entry edits follow the existing reload contract. No typegen hooks anywhere.
- **`mcp-use build`:** bundles each view (client environment) into `.mcp-use/build/views/` and writes the manifest entries (`view name → assets`) consumed by `start` and serverless handlers.
- **`mcp-use start`:** serves prebuilt view assets from the manifest; no vite, no discovery.

## Testing

- **Type-level** (`tests/type-level.test.ts` pattern): `ToolRef` name/input/output inference incl. non-zod Standard Schema libs; `ToolsFromModule` filtering and re-export composition; `useCallTool` name union + arg/result types; empty-`Register` fallback; `view()` props-vs-`outputSchema` agreement; `ViewProps` (output) vs `LoadingProps` (deep-partial input) source flip.
- **e2e over HTTP** (official client): view resource listing/reading with correct mimetype and `_meta.ui.*`; capability-gated `tools/list` variance from per-request `_meta`; **channel separation** — `view({ props, content, meta })` lands as `structuredContent` / `content` / `_meta` respectively, with `meta` absent from everything model-facing.
- **Bridge-level:** a minimal `AppBridge` (ext-apps host class, devDep) driving a built view — initialize handshake, `tool-input-partial` sequence rendering `Loading` with progressive `partialInput`, tool-result delivery swapping `Loading` for the component with props, `tools/call` round-trip, `meta` surfaced on `useView().meta`; **view tools** — `bridge.listTools()` reflects mounted `useViewTool`s, call round-trip mutates component state, unmount/`enabled: false` emits `list_changed` and removes/disables.

## Deltas vs v1 (for the migration guide)

1. Every `widget` name → `view` (`widget:` config, `widget()` helper, `useWidget*`, `WidgetControls`, `ui://widget/…` → `ui://views/…`).
2. Components receive props directly (`<View {...props} />` from the runtime); `useWidget().props` / `useWidgetProps()` become `useView().props` / `useViewProps()` escape hatches. Props are the `view({ props })` payload only — v1's `toolInput` merge is gone (read input via `useView().toolInput`).
3. `widgetMetadata` export → `metadata` (`ViewMetadata`); its zod `props` schema requirement is dropped — props types come from `outputSchema`.
4. In-component `isPending` skeleton branching → optional `Loading` export.
5. `useCallTool` types come from exporting tool refs, not from generated `.mcp-use/generated/tool-registry.d.ts`; template `postinstall`/dev-loop typegen is gone.
6. `useViewState` no longer persists across sessions nor implicitly feeds the model; use `ModelContext` for model visibility.
7. `useFiles` removed (ChatGPT-only capability).
8. `window.openai` is never consumed by the runtime; ChatGPT works through its native MCP Apps support.
9. Tool config `invoking`/`invoked`/`widgetAccessible` removed (openai overlay, no spec equivalent; `visibility` covers app/model narrowing).
10. Views work against the stateless 2026-07-28 wire; nothing view-related depends on sessions.

## Open questions

- Stable `ui://views/<name>.html` vs content-hashed URIs: revisit only with evidence that a target host over-caches by URI (v1's `buildId` existed for ChatGPT; ChatGPT's MCP Apps path may not need it).
- `ui/download-file` (draft) exposure — as a `useView` action or standalone hook — once a target host ships it.
- Partial/streamed **tool results**: not in the 2026-07-28 protocol or the apps spec today (see Streaming). When a partial-result channel lands upstream, deliver it as ordinary prop re-renders; until then, progressive UIs pull via `useCallTool`.
- Sampling from views (`createSamplingMessage`, draft) — post-alpha, follows the server package's Phase-4 sampling posture.
- Overlay mechanism shape (if a host demands `openai/*` keys): registration-boundary transform, opt-in per server or per host detection — design when needed.

