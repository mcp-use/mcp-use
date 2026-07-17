# mcp-use — Views (MCP Apps) spec

**Status:** design contract, pre-implementation. Companion to `SPEC.md` (whose views phase points here) and `CLI_SPEC.md` (the implemented `dev`/`build`/`start` base contract this document extends).
**Scope:** the views runtime in the server package, view resources and protocol metadata, the React view runtime (`/react` subpath), the zero-codegen typing layer (`ToolRef` / `Register`), and the views half of the `dev`/`build`/`start` contract.
**Tracking:** Linear MCP-2601 (Views & MCP Apps + typing), MCP-2180 (widget→view naming).
**v1 reference:** `packages/mcp-use` (`src/react/`, `src/server/widgets/`) defines *what* views must be able to do, never how. Parity with v1 is the alpha goal; the architecture is not carried over.

## Decisions at a glance

1. **One protocol: MCP Apps.** The [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) (`io.modelcontextprotocol/ui`, spec revision `2026-01-26` + draft) is the only wire format. The v1 adapter system (`AppsSdkAdapter`, dual-protocol metadata, `window.openai` transport) is **not ported**.
2. **Public naming is "view", everywhere.** `view` tool config, `useToolContext` hook, `ui://views/…`. "Widget" survives nowhere in the v2 API.
3. **`tool()` returns `ToolRef<Name, Input, Output>`** (not `this`). Typed `useCallTool` is pure type inference over exported refs — zero codegen, nothing generated on the dev/build hot path.
4. **Hook-first, latched view data.** The default export mounts when bootstrap starts the connection — before any tool result — and stays mounted for the iframe lifetime; the runtime never spreads props onto it. `useToolContext<Name>()` is the primary data API: a discriminated union over `pending` / `ready` / `error`. While pending, partial and complete inputs replace one `DeepPartial<Input>` `toolInput` snapshot. The first structured success or tool error is latched permanently; content-only successes are valid ambient activity and are ignored. Split hooks cover host context and actions; there is deliberately no aggregate hook.
5. **The React runtime builds on `@modelcontextprotocol/ext-apps`** (guest `App` class); the server package **inlines** the few wire constants and emits spec `_meta` itself — no ext-apps import server-side. Bootstrap creates a `McpAppRuntime` with exactly one eagerly configured App and one cached connection attempt; initialization failure is terminal for that mount. The runtime owns capabilities, snapshots, and deterministic disposal; the official ext-apps `App` owns MCP Apps protocol behavior; React hooks subscribe to narrow external-store channels via `ViewRuntimeContext`.
6. **No response helpers — views included.** The no-response-helpers ground rule (`SPEC.md`) applies without exception. View-bound tool handlers return a plain `CallToolResult`: `{ content, structuredContent, _meta? }`. `structuredContent` is typed by the tool's `outputSchema` at the return position (existing `ToolResult<TOutput>` machinery).
7. **React runtime ships as `mcp-use/react`.** `react` and `react-dom` are optional peers owned by the application.
8. **Parity with v1 hooks, minus two named gaps** (file upload, cross-session view state) that the MCP Apps spec cannot express — see "Dropped from v1".
9. **Views build into `.mcp-use/build/views/` and serve under `${basePath}/_mcp-use/`.** One self-contained Vite client build per view (JS + CSS inlined into the synthesized document — zero asset fetches at srcdoc boot so the app initializes before/early-into argument streaming; hosts drop pre-`ui/initialize` notifications per ext-apps AppBridge; matches the Excalidraw MCP App reference design; trade-off: no shared chunks across views), a manifest-driven registration path identical for `start` and serverless, request-scoped origin for public assets / CSP. Hosts obtain the view document only through `resources/read`; the only HTTP surfaces are the public-asset route and (in dev) Vite middleware. v1's `mcp-use/widgets` routes are not carried over — see "Build system & serving".
10. **One tool binds one view; every binder declares an `outputSchema`; the binder owns all resource facts.** A view has zero or one bound tool; a bound tool has exactly one view. A second tool declaring `view: { name }` for an already-bound view is a **hard error** at registration naming both tools. Every view-bound tool requires an `outputSchema` (hard error otherwise). The single binder owns all resource facts (`description`, `csp`, `permissions`, `domain`, `prefersBorder`). A `view:` naming a missing view directory is a **hard error** (broken `resourceUri`). A view directory no tool binds is a **warning only** (unused-code class: harmless dead weight, and erroring would break the scaffold-view-first authoring order and make feature-flagging a tool off a deploy-breaking action). App-only helper tools remain viewless (`visibility: "app"`, no `view:`) and are called from the view via `useCallTool`; use a separate view resource when another tool needs a rendered result.
11. **Views register from the manifest as code — no filesystem on any MCP path.** `mcp-use build` bakes the views manifest into a generated wrapper entry that primes the server instance before anything mounts; `resources/read` synthesizes the HTML from manifest data per request. No runtime `fs` read, and deliberately no fallback — an unprimed `view:` is a loud mount-time error. See "Registration mechanism".
12. **Dev shares the one Vite dev server `mcp-use dev` already runs.** The views client environment joins that server; view-file edits get real Vite HMR with **React Fast Refresh** through the framework-owned React plugin. Tailwind is also framework-owned and always available. A project `vite.config.*` may add other view-client plugins; it never configures the server environment. The server entry keeps the implemented reload-and-swap contract (`CLI_SPEC.md`). Every server handler generation shares one SDK event bus; successful entry reloads publish tool, prompt, and resource list invalidations so connected modern clients refetch from the new stateless handler.
13. **Tool visibility is a top-level `ToolDefinition` field.** `visibility?: "model" | "app"` lives on the tool itself (`server.tool({ name, visibility: "app", … })`), not inside `view:`. Emitted as `_meta.ui.visibility: ["model"] | ["app"]` on `tools/list` for any tool that sets it — view-bound or not — and omitted entirely when unset (host default: callable by the model, visible to the app). The server always lists every registered tool; filtering is host policy (MCP Apps: hosts MUST hide `visibility: ["app"]` tools from the model and MUST reject app `tools/call` for tools without `"app"`). Never on tool results. App-private helper tools (e.g. `save-checkpoint`) are plain tools with `visibility: "app"` and usually no `view:` binding — the view calls them via `useCallTool` and their results return to the caller; a `view:` binding is only for tools whose results should render the view.
14. **`viewConfig` is immutable pre-render runtime configuration.** A view file may export an optional `viewConfig` alongside the default component. It is normalized and validated before the App is constructed (`autoResize`, `displayModes`). React presentation settings do not belong there. Users compose optional presentation components (`ThemeProvider`, `ViewControls`, their own `StrictMode`/error boundary) directly; bootstrap provides the required top-level error boundary. Every view runtime advertises App tools (`tools: { listChanged: true }`) and serves an empty list before the first `useViewTool` registration.

---

## The running example

Used throughout this document. One tool, one view, one schema — every snippet below agrees with this shape:

```ts
// src/index.ts (server entry)
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({ name: "fruit-store", version: "1.0.0" });

const resultsSchema = z.object({
  query: z.string(), // echoed from the input so the model sees what the user searched — result payload for the ready branch
  items: z.array(
    z.object({ id: z.string(), name: z.string(), imageUrl: z.string() })
  ),
});

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: {
      name: "product-search-result",
      description: "Product search results grid",
      csp: { resourceDomains: ["https://images.example.com"] },
      prefersBorder: true,
    },
  },
  async ({ query = "" }) => {
    const items = await search(query);
    return {
      content: [{ type: "text", text: `Found ${items.length} fruits` }],
      structuredContent: { query, items },
    };
  }
);

export default server;
```

```tsx
// resources/product-search-result/view.tsx
import { useToolContext } from "mcp-use/react";

export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  return <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />;
}
```

Note what makes this consistent: while pending, `query` arrives progressively via `toolInput` (fed by the tool's **input** schema — partials and the complete input share one last-write-wins field); after a successful result, `view.toolOutput` is exactly `structuredContent` (typed by `outputSchema`) — never a merge of the two channels. Tool errors land on the `"error"` branch. A content-only non-error result is valid ambient activity and leaves the context pending. The handler still echoes `query` into the output so the model sees it; the pre-result window no longer depends on that echo.

---

## Protocol posture

### Why no adapters

ChatGPT natively implements the MCP Apps bridge and metadata ([OpenAI: MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)) — their guidance is "build with the standard by default; `window.openai` only for ChatGPT-specific extensions". Every host we target (ChatGPT, Claude, our inspector) speaks the standard, so the v1 dual-emission machinery buys nothing. If a host ever requires an `openai/*` (or other vendor) overlay, it re-enters as a pure metadata transform at the registration boundary — an additive change with no architectural cost, deferred deliberately.

`window.openai` extensions (checkout, modals, file pickers) are likewise out of scope for the alpha. Views that need them can feature-detect the global themselves; the runtime neither wraps nor depends on it.

### Spec target

We track the ext-apps **draft** spec (the SDK is beta; the draft adds `ui/download-file`, sampling, and the `message`/`updateModelContext` host-capability declarations) while emitting the stable `2026-01-26` protocol version constant, matching what the current ext-apps release itself does. Not everything in the spec is implemented for the alpha — the surface is driven by v1 parity (see the hook table), not spec completeness.

### Wire metadata

Emitted by this package (constants inlined; names are the spec's):

| Where            | Key                                                         | Value                                                        |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| tool `_meta`     | `ui.resourceUri`                                            | `ui://views/<view-name>.html`                                |
| tool `_meta`     | `"ui/resourceUri"`                                          | same value (legacy flat key, kept while hosts still read it) |
| tool `_meta`     | `ui.visibility`                                             | `["model"]` / `["app"]` when the tool's top-level `visibility` is set — any tool, view-bound or not; **omitted entirely when unset** (host default: callable by the model, visible to the app). Declaration only — the server always lists every tool; hosts filter by this key. |
| tool result `_meta` (view-bound `tools/call`, non-error) | `ui.resourceUri` | `ui://views/<view-name>.html` |
| tool result `_meta` (view-bound `tools/call`, non-error) | `"ui/resourceUri"` | same value (legacy flat key) |
| resource (`resources/list` entry) | `description`                                    | from the bound tool's `view.description`                     |
| resource (`resources/list` entry) | `mimeType`                                       | `text/html;profile=mcp-app`                                  |
| resource (`resources/list` entry) `_meta` | `ui.csp`                             | `{ connectDomains, resourceDomains }` — author domains from the bound tool's `view.csp`, plus the request-resolved serving origin auto-appended to `resourceDomains`; in dev, the serving origin's websocket variant (`ws://`/`wss://`) is also auto-appended to `connectDomains` (see Dev) |
| resource (`resources/list` entry) `_meta` | `ui.permissions`                     | from the bound tool's `view.permissions` when set            |
| resource (`resources/list` entry) `_meta` | `ui.domain`                          | from the bound tool's `view.domain` when set                 |
| resource (`resources/list` entry) `_meta` | `ui.prefersBorder`                   | from the bound tool's `view.prefersBorder` when set          |
| resource content item (`resources/read` `contents[]`) | `mimeType` | `text/html;profile=mcp-app`                                  |
| resource content item (`resources/read` `contents[]`) | `text`     | synthesized HTML document (origin-resolved per request)      |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.csp` | same shape as the list entry; **content-item value takes precedence** per MCP Apps spec — request-resolved serving origin (and dev HMR websocket origin in `connectDomains` when dev-primed) |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.permissions` | same as list entry when set |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.domain` | same as list entry when set |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.prefersBorder` | same as list entry when set |

Authors may also provide custom tool definition `_meta`. The registration boundary shallow-copies it and merges the framework-owned tool keys deterministically. The framework owns nested `ui.resourceUri`, nested `ui.visibility`, and legacy flat `"ui/resourceUri"`: a declared `view`/`visibility` supplies the canonical value and wins a collision; when the corresponding field is absent, a user-supplied value for that owned key is removed rather than advertising a contract the tool did not declare. Other top-level vendor keys and other fields of an object-valued `ui` entry are preserved. The merge never mutates the caller's object, never recursively assigns user keys into an existing target, and treats keys such as `__proto__` as data. This definition merge affects only `tools/list`; tool-result `_meta` retains the separate result-stamping rules below.

Security metadata (CSP, permissions, domain, prefersBorder) lives on the **resource**, never the tool — hosts ignore tool-level copies per spec. Authors declare external domains in the bound tool's `view.csp`; the framework appends its serving origin to `resourceDomains` at emission time. Spec-canonical hosts read `UIResourceMeta` from each `resources/read` content item's `_meta.ui` (the list entry is a static fallback; the content-item copy takes precedence). Both surfaces carry the same author facts; the read-time copy uses the per-request resolved origin so CSP always matches the synthesized HTML's public-asset URLs.

Error results (`isError: true`) are **not** stamped with resource-URI metadata — an error must not create a new rendered view through legacy host behavior that keys off result `_meta.ui.resourceUri`.

### Capability gating (stateless-first)

Per the `SPEC.md` stateless posture, UI support is a **request-scoped** fact: the 2026-07-28 wire carries `clientCapabilities` in per-request `_meta`, and MCP Apps support is `capabilities.extensions["io.modelcontextprotocol/ui"]` advertising `mimeTypes: ["text/html;profile=mcp-app"]`. Nothing is ever inferred from remembered sessions.

**The wire surface is unconditional.** `tools/list` always includes every registered tool regardless of client capabilities or top-level `visibility`. View-bound tools always carry `_meta.ui.resourceUri` (plus the legacy flat `"ui/resourceUri"` key) on `tools/list`, and every non-error result from that tool is stamped with the same link keys — regardless of whether the client advertises the UI extension. View resources always carry `_meta.ui` (framework auto-CSP with the serving origin) on both `resources/list` entries and each `resources/read` content item. When a tool's top-level `visibility` is set, `_meta.ui.visibility` is emitted as a declaration (`["model"]` or `["app"]`); filtering by that declaration is **client policy** — the server never omits tools from `tools/list`.

**Capability negotiation affects handler branching only.** The user-facing request-context query `ctx.client.supportsViews()` (`RequestContext` grows per phase — this reads per-request capabilities, never session state) lets handlers shape output differently for UI-capable vs text-only hosts:

```ts
export const searchFruits = server.tool(
  { name: "search-fruits", inputSchema: z.object({ query: z.string().optional() }), outputSchema: resultsSchema, view: { name: "product-search-result" } },
  async ({ query = "" }, ctx) => {
    const items = await search(query);
    if (!ctx.client.supportsViews()) {
      // materially different output for text-only hosts (optional — see note)
      return {
        content: [{ type: "text", text: renderAsMarkdownTable(items) }],
        structuredContent: { query, items },
      };
    }
    return {
      content: [{ type: "text", text: `Found ${items.length} fruits` }],
      structuredContent: { query, items },
    };
  }
);
```

Note the branch is *optional*: a plain `CallToolResult` already degrades on text-only hosts (`content` is present; result `_meta.ui.*` is ignored). `ctx.client.supportsViews()` exists for when the two audiences deserve materially different output, not as a required ritual.

### ext-apps dependency posture

Until the v2 migration is published, the package pins the preview build from ext-apps PR #712 (`https://pkg.pr.new/@modelcontextprotocol/ext-apps@712`) together with the `client`, `core`, and `server` preview builds from its prerequisite TypeScript SDK PR #2501. Those SDK packages report version `2.0.0-beta.4`, but the registry beta.4 client does not export the `Protocol` base class ext-apps requires, so the preview URLs are part of the pin. This stack keeps `ui/initialize` as the only iframe handshake and accepts Standard Schema validators for App tools. Consequences:

- **Server side: keep our own thin registration layer.** Ext-apps' v2 server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`) are now compatible, but this framework already owns view binding, manifest validation, per-request resource emission, and its `ToolRef` return type. The replacement remains intentionally small: inlined wire constants (mimetype, `_meta.ui.*` keys, extension ID), `_meta` emission at tool/resource registration, and a `getUiCapability` equivalent over per-request `extensions["io.modelcontextprotocol/ui"]`. Server-side types use **type-only imports** of canonical ext-apps types (`McpUiResourcePermissions`, `McpUiResourceCsp`) — zero runtime reach into ext-apps. Published declarations reference those types; tool-only projects without ext-apps installed see `UiPermissions` and `csp` degrade to `any` under `skipLibCheck` — acceptable because those fields only matter for view projects, which declare ext-apps.
- **View side: reuse essentially the whole guest protocol stack.** The React runtime wraps ext-apps' `App` + `PostMessageTransport`: Apps-only handshake, capability negotiation, the event system with one-shot replay, all outbound methods (`callServerTool`, `sendMessage`, `openLink`, `requestDisplayMode`, `updateModelContext`, `sendLog`, `downloadFile`, size-changed/auto-resize, teardown), the complete App-tools implementation (`registerTool` — see View tools), style helpers, and the `McpUi*` types. App tools pass their Standard Schema validators directly to ext-apps, which validates input and output and converts them to JSON Schema without a zod-specific compatibility bridge. Our `/react` code is product surface only — hooks, bootstrap, typing layer, presentation components — no protocol code.
- **Host side (inspector, test harness): reuse `AppBridge` with `client: null`** — its explicit escape hatch for hosts without an attached `Client`; request handlers (`oncalltool`, `onlistresources`, …) forward to the v2 client stack manually.
- **Dependency mechanics:** ext-apps is regular framework implementation machinery. The package pins the ext-apps #712 preview and TypeScript SDK #2501 previews as one coordinated set, so `npm install mcp-use` provides the complete view runtime without extra installation steps. Lazy browser and command entry points keep tool-only imports from evaluating ext-apps or Vite. Replace all preview URLs with the corresponding published releases together once both PRs land.

---

## Server API

### File-based views (the first-class authoring path)

View components live under `resources/` (fixed convention, one directory per view, `view.tsx` as the component entry — the directory is named for what views *are* on the wire: MCP resources). There is deliberately no `viewsDir` knob in the alpha, matching `CLI_SPEC.md`'s no-config-file rule; a constructor field can be added later without breaking anything.

```
resources/
  product-search-result/
    view.tsx        # default-exports the component; may also export viewConfig
    types.ts        # any other files in the directory are ordinary modules the view may import
```

A view file has two recognized exports: the **default export** — the component, mounted for the iframe lifetime and reading data through hooks (see Component lifecycle & view data) — and an optional immutable **`viewConfig`** export containing pre-render runtime configuration (`autoResize`, `displayModes`; see React runtime). Resource facts (description, CSP, permissions, domain, prefersBorder) live exclusively on the bound tool's server-side `view:` config (decision 10). Result types flow from that tool's `outputSchema` via `useToolContext<Name>()`.

Discovery registers one `ui://views/<dir-name>.html` resource per view; at most one tool may bind it (decision 10; an unbound view warns). The **build/dev manifest is the source of truth** for what views exist and what asset each serves — production never rediscovers the filesystem and never re-reads the manifest either: it reaches the runtime as code (Registration mechanism, below). Nothing depends on `handler.toString()`.

Inline JSX returned from tool handlers is a documented **stretch** authoring model and is out of this contract; it must layer on the file-based path without changing it.

### Binding a tool to a view

The `view:` config on `server.tool()` binds the tool to a view resource. Resource wire facts (`description`, `csp`, `permissions`, `domain`, `prefersBorder`) are authored on that tool's `view:` — the single binder owns all facts (decision 10). Tool visibility is a separate top-level `ToolDefinition` field (`visibility?: "model" | "app"`), not part of `view:` (decision 13). The view file exports the component (and optional `viewConfig`); the framework reads the binder's `view:` fields at registration and emits them on the view's MCP resource (where hosts read them per spec — tool-level copies are ignored).

```ts
// tool-level (any tool — view-bound or not):
visibility?: "model" | "app";      // → _meta.ui.visibility on tools/list; omitted = host default (model + app)

view: {
  name: string;                    // view directory name, e.g. "product-search-result"
  description?: string;            // → resource description on resources/list and resources/read
  csp?: {                          // → resource _meta.ui.csp (framework auto-appends serving origin to resourceDomains)
    connectDomains?: string[];
    resourceDomains?: string[];
  };
  permissions?: UiPermissions;     // → resource _meta.ui.permissions
  domain?: string;                  // → resource _meta.ui.domain
  prefersBorder?: boolean;         // → resource _meta.ui.prefersBorder
}
```

Authors declare every external domain the view loads in the binder's `view.csp.resourceDomains` (and fetch targets in `connectDomains`). The framework always emits `csp` on the resource and appends its request-resolved serving origin to `resourceDomains` so public assets from the serving origin remain loadable. Hosts enforce CSP strictly — undeclared domains are blocked.

Binding rules (decision 10), enforced where the wire would lie — at registration in dev, at build in prod:

- `view.name` naming a missing view directory is a **hard error** (broken `resourceUri`).
- A `view:` tool without an `outputSchema` is a **hard error** — the output contract *is* the `outputSchema` (`useToolContext<"search-fruits">()` reads it). A view that takes no result payload binds to a tool with an empty object schema (`outputSchema: z.object({})`).
- A view has zero or one bound tool; a bound tool has exactly one view. A second tool declaring `view: { name }` for an already-bound view is a **hard error** at registration naming both tools, e.g. `View "canvas" is already bound to tool "draw"; tool "refresh" cannot bind the same view. Each view may be bound to one tool.` Use a separate view resource when another tool needs a rendered result. App-only helper tools remain viewless and are called from the view via `useCallTool`.
- A view directory no tool binds is a **warning naming the view**, never an error — nothing on the wire is wrong (no host renders a view except through a tool result's `_meta.ui.resourceUri`), and erroring would punish the natural authoring order (view directory first, tool second) and turn feature-flagging a tool off into a build/deploy breaker. Unbound views are still built and registered — `resources/read` staying live is useful for inspector preview of not-yet-wired views.

The check itself is a set difference at mount time — the frozen tool registry against the primed view registry — re-run per dev reload.

The v1 `invoking`/`invoked` strings and `widgetAccessible` flag are `openai/*` overlay concepts with no spec equivalent — dropped from the alpha config (space reserved in a future overlay, not here).

### Returning results from view-bound tools

View-bound tool handlers return a plain `CallToolResult` — the same shape as every other tool, with no response helpers:

```ts
return {
  content: [{ type: "text", text: "…" }],   // model/text-host narrative; also surfaced to the view
  structuredContent: { … },                  // model AND view; typed by outputSchema → toolOutput in the view
  _meta?: { … },                             // view ONLY; never enters model context
};
```

**Compile-checking against `outputSchema`.** The existing return-position contract applies: a tool with an `outputSchema` types its callback's return as `ToolResult<Output>`, which only accepts `CallToolResult & { structuredContent: Output }` (or an `isError` result). A `structuredContent` payload that doesn't match the tool's `outputSchema` fails at the handler's return position.

The handler and the view component are two ends of one call: `structuredContent` is forwarded to the bound view; `useToolContext<Name>()` surfaces the first structured result as `toolOutput` when `status === "ready"`. A valid MCP tool error (`isError: true`) lands on the `"error"` branch. A content-only non-error notification cannot be identified as the bound result and is ignored.

**Auto-stamping result `_meta`.** The framework auto-stamps `_meta.ui.resourceUri` (plus legacy flat `"ui/resourceUri"`) onto every non-error result of a view-bound tool — so clients know an MCP App can render. Error results (`isError: true`) are not stamped. Handlers may pass additional keys on `_meta` for view-only data. On collision, wire keys win over handler keys; the reserved namespace is `ui.*` (`mcp-use/*` is reserved for framework use but carries no wire key on results).

### Channel visibility: what the model sees vs what the view sees

The full `CallToolResult` reaches the view (the host forwards it via `ui/notifications/tool-result`); what reaches the **model** is host policy, but the spec's design assumption — and ChatGPT's behavior — is: `content` and `structuredContent` are model-facing, `_meta` is not. Design for that split; never put secrets in any tool result channel (the view is still client-side).

| Data | Model | View | Text-only host | Carried as |
| --- | --- | --- | --- | --- |
| `structuredContent` | ✅ | ✅ (`useToolContext().toolOutput` when `ready`) | host may render raw | `structuredContent`, typed by `outputSchema` |
| `content` | ✅ | ✅ (`useToolContext().content` when `ready` or `error`) | ✅ (the fallback) | `content` blocks |
| result `_meta` (handler keys) | ❌ | ✅ (`useToolContext().meta` when `ready` or `error`) | ❌ (ignored) | result `_meta` |
| tool input | ✅ (it authored it) | ✅ (`useToolContext().toolInput` — latest partial or complete pending snapshot) | ✅ | `tools/call` arguments |
| view→model context | ✅ (subsequent turns) | source | n/a | `ui/update-model-context` / `ModelContext` |
| view-tool result | ✅ (it called the tool) | source | n/a | `tools/call` over the bridge → `useViewTool` handler |

Consequences worth spelling out in docs:

- **`structuredContent` is model-visible.** That is a feature — the model reasons over exactly what the user is looking at — but it prices structured output in tokens and rules it out for bulk payloads. The dividing question for every field: *should the model see this?* Yes → `structuredContent`; no (bulk, presentation-only, e.g. base64 images, geometry, full result sets beyond what's discussed) → `_meta`.
- **`content` is the model/text-host narrative** ("Found 12 results, top match …"). Handlers should pass a short summary; since `structuredContent` is already model-visible, omitting `content` leaves text-only hosts with only the structured payload.
- **Result `_meta` is the view-only channel**: handler-supplied keys are preserved on result `_meta`, read via `useToolContext().meta` when `ready` or `error`, never typed by `outputSchema`, never model context. The framework also stamps the wire `ui.*` link keys (`ui.resourceUri`, `"ui/resourceUri"`) onto every non-error result from a view-bound tool. The reserved namespace is `ui.*`; wire keys win on collision.
- The reverse direction is explicit, not ambient: nothing a user does *inside* the view reaches the model unless sent via `ModelContext`/`updateModelContext` (model context push, no follow-up turn), `sendFollowUpMessage` (`ui/message`, triggers a turn), or returned from a view tool (*model-initiated*, see View tools).

### URI scheme and serving

- Resource URI: `ui://views/<name>.html` — stable across builds. (v1 embedded a `buildId` for ChatGPT's per-URI caching; that is an overlay concern. If host caching demonstrably requires it, a content-hash suffix comes back via the manifest — deferred to implementation evidence, see Open questions.)
- The resource body is a complete HTML document (rendered by hosts via `srcdoc` after `resources/read`). In **production** the document is fully self-contained: view JS and CSS are inlined (`<script type="module">` / `<style>`) so the iframe boots with zero network fetches for the view bundle. In **dev** the same shell loads Vite module URLs (`/@vite/client` + the virtual entry) for HMR. The document is **synthesized per request from the manifest entry** — never read from disk (see "Registration mechanism"). Public-folder assets still load over HTTP from `${basePath}/_mcp-use/public/`. Hosts obtain the view document only through `resources/read`; there is no HTTP document or bundle-asset route. The full contract — build pipeline, routes, origin derivation, caching — is "Build system & serving", below.

### Wire shape (reference — what our registration layer emits)

For the running example, `tools/list` carries:

```jsonc
{
  "name": "search-fruits",
  "inputSchema": { /* JSON Schema converted from `inputSchema` */ },
  "outputSchema": { /* converted from `outputSchema` */ },
  "_meta": {
    "ui": { "resourceUri": "ui://views/product-search-result.html" },
    "ui/resourceUri": "ui://views/product-search-result.html"   // legacy flat key, kept while hosts read it
  }
}
```

and `resources/list` carries:

```jsonc
{
  "uri": "ui://views/product-search-result.html",
  "name": "product-search-result",
  "description": "Product search results grid",
  "mimeType": "text/html;profile=mcp-app",
  "_meta": {
    "ui": {
      "csp": {
        "connectDomains": [],
        "resourceDomains": [
          "https://images.example.com",   // ← author-declared in view.csp.resourceDomains
          "https://fruit-store.fly.dev"   // ← request-resolved serving origin, auto-appended by the framework (see Serving)
        ]
      },
      "prefersBorder": true              // ← from view.prefersBorder when set
    }
  }
}
```

`resources/read` returns a `contents[]` item with the same `mimeType` and `_meta.ui` fields (content-item value takes precedence per MCP Apps spec) plus the synthesized HTML as `text`:

```jsonc
{
  "contents": [
    {
      "uri": "ui://views/product-search-result.html",
      "mimeType": "text/html;profile=mcp-app",
      "text": "<!doctype html>…",        // ← origin-resolved per request
      "_meta": {
        "ui": {
          "csp": {
            "connectDomains": [],
            "resourceDomains": [
              "https://images.example.com",
              "https://fruit-store.fly.dev"   // ← per-request origin (public assets / CSP; view JS/CSS are inlined)
            ]
          },
          "prefersBorder": true
        }
      }
    }
  ]
}
```

Resource `_meta.ui` carries author facts from the bound tool's `view:` config plus the framework's auto-appended serving origin in `csp.resourceDomains`. Fields the author did not set (`permissions`, `domain`, …) are omitted. The list entry and each read content item emit the same author facts; the read-time copy resolves the serving origin per request so CSP always matches the synthesized HTML. Clients without the UI extension still receive `ui.*` metadata on view resources, view-bound tools, and every tool on `tools/list` (including tools with top-level `visibility: "app"`, which carry `_meta.ui.visibility: ["app"]` for the host to filter).

---

## Build system & serving

Extends `CLI_SPEC.md`'s implemented workspace and command contract (its ground rules hold: `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk, no config file, fixed `.mcp-use/` layout). v1 reference: `packages/cli` `buildWidgets` + `packages/mcp-use/src/server/widgets/*` define what the pipeline must deliver — built assets, a manifest, HTTP serving for public assets, dev HMR — never how. The v1 mechanics (scratch `entry.tsx`/`index.html` files in `cache/`, boot-time origin baking, regex rewriting of built HTML, `window.__getFile` indirection, auto-injected Tailwind) are **not** carried over.

### One self-contained client build per view

`mcp-use build` gains a **client environment** alongside the existing node/SSR build — **one Vite build invocation per discovered view**, each producing a single self-contained ES module. Entries are **virtual modules** (`virtual:mcp-use/views/<name>`, resolved by the views plugin inside `src/cli/`), not scratch files: each imports the runtime's iframe bootstrap from the `/react` runtime and the view module (default export + optional `viewConfig`), and mounts per the Component lifecycle & view data contract (bootstrap creates the runtime, starts connection, mounts React immediately; App tools always advertised). Nothing is written to `cache/` for entries; nothing user-visible is generated.

Each per-view build disables code splitting (`codeSplitting: false` / no shared chunks), sets `cssCodeSplit: false` (one CSS asset), and uses a large `assetsInlineLimit` so imported assets become data URLs inside the bundle. After the build, the CLI reads the emitted JS and CSS text (build-time `fs` is fine) and records them in the manifest as **content**, not paths. Rationale: MCP Apps hosts render the view via `resources/read` into a sandboxed `srcdoc` iframe and stream tool arguments with `ui/notifications/tool-input-partial` while the model generates them; ext-apps' AppBridge does **not** buffer or replay notifications sent before the app completes the `ui/initialize` handshake. A self-contained document boots with zero asset fetches, so the app initializes early enough to catch the stream — matching the Excalidraw MCP App reference design. Trade-off accepted: no shared chunks across views; each view is an independent bundle (React and the runtime are duplicated per view).

Output layout (intermediate build artifacts under `views/<name>/` may remain on disk for tooling; the runtime never reads them on the MCP path):

```
.mcp-use/build/
├─ index.js                       ← generated wrapper entry: primes views (inline js/css strings), re-exports the server
├─ manifest.json
└─ views/
   ├─ public/                     ← copied project `public/` (served over HTTP)
   └─ <name>/assets/…             ← per-view build scratch (JS/CSS already inlined into the manifest)
```

There are **no HTML files in the build output**: the view document is a pure function of the manifest entry — a minimal shell (`<div id="root">`, inline `<style>` when CSS is present, inline `<script type="module">` with the view JS, plus the request-scoped `__mcpUseViewConfig` config script) — so the runtime synthesizes it per request instead of the build writing it to disk (see "Registration mechanism"). Public-folder assets still need absolute URLs (hosts render via `srcdoc`); those resolve per request. The client build uses Vite's relative `base: "./"` so any residual relative references inside the inlined module resolve from `import.meta.url` if needed. This eliminates v1's entire rewrite layer (three regexes over built HTML + four injected `window.__*` globals) and the document files with it.

**Vite configuration:** `mcp-use` owns server compilation and all required view invariants. It always injects Tailwind, React, and views plugins, and every virtual view entry imports a virtual `@import "tailwindcss"` stylesheet. Utility classes therefore work with no author CSS import. Project `vite.config.*` files are loaded only for per-view client builds, where any additional user plugins and aliases are additive.

### Manifest

Extends the `CLI_SPEC.md` manifest (`.mcp-use/build/manifest.json`) with a `views` map — the **source of truth** for registration and serving (Discovery, above: production never rediscovers the filesystem):

```jsonc
{
  "buildId": "…", "entryPoint": "index.js", "createdAt": "…", "inspector": true,
  "views": {
    "product-search-result": {
      "kind": "inline",
      "js": "…minified ES module source…",
      "css": "…aggregated stylesheet text…"
    }
  }
}
```

The `views` map is emitted twice from one build-time source: into `manifest.json` (tooling and introspection — the `CLI_SPEC.md` workspace contract) and **baked into the generated wrapper entry as code** (the runtime's copy — see "Registration mechanism"). The runtime never reads the JSON file. Production entries are `{ kind: "inline", js, css }`; dev priming emits `{ kind: "external", entry, css, scripts? }` (Vite module URL paths). Large inline strings are accepted — that is the cost of the no-fs-on-MCP-path rule.

### Paths: public assets → URL → disk

View JS/CSS do not travel as separate HTTP assets in production (they are inlined). Public-folder files use one path space:

- **On disk**, `public/` is copied to `.mcp-use/build/views/public/`.
- **On the wire**, public files are addressed at `GET ${basePath}/_mcp-use/public/<path…>`. There is no HTTP route for view documents or bundle assets — hosts obtain the document only through `resources/read`.

### Registration mechanism

How manifest data becomes MCP registrations. Two facts about the implemented server shape every design must live under: the registry **freezes at first mount** (registration after `listen()`/`getHandler()` throws — registrations are replayed per request, late ones would be silently inconsistent), and `getHandler()` is **synchronous** and typically called at module scope in serverless entries. So view registration must be complete by the time the entry module finishes evaluating, and it cannot await a filesystem read to get there. v1's trigger — `mountWidgets()` doing async `fs` work *inside* `listen()`/`getHandler()`, then calling `server.uiResource()` — is structurally impossible here and is not wanted back.

**Instance registry, primed via an internal API.** `MCPServer` grows a views registry alongside `#tools`/`#resources`, populated through one symbol-keyed method:

```ts
// exported from the package root, tagged @internal (non-public by convention;
// physically reachable so generated code and the CLI can use it)
export const registerViews: unique symbol;

// on MCPServer:
[registerViews](views: ViewsManifest, options?: { dev?: boolean }): void;   // throws if already primed, or after first mount

type ViewManifestEntry =
  | { kind: "inline"; js: string; css: string }   // production: self-contained
  | { kind: "external"; entry: string; css: string[]; scripts?: string[] }; // dev: Vite module URLs

interface ViewsManifest {
  [viewName: string]: ViewManifestEntry;
}
```

The same package's CLI (`src/cli/`) imports the symbol directly; the generated wrapper entry imports it from the package root. View resources are *not* sugar over the public `resource()`: their `_meta.ui.*` emission and body are origin-resolved per request, so the per-request SDK-server build does the emission itself — register each view's resource (mimetype, `_meta`, serving origin auto-appended to `csp.resourceDomains` for public assets/images), synthesize the document from the manifest entry on read, and stamp `_meta.ui.resourceUri` onto the bound tool. The tool-side URI needs no manifest data (deterministic from `view.name`); the primed registry's job at the tool boundary is validation — the binding checks of decision 10. Priming is deliberately an instance method, not a module global: no evaluation-order coupling, composes with several servers in one process, and re-runs naturally in dev's fresh-instance-per-reload loop. (Skybridge, the closest prior art, ships the same manifest-as-code mechanism but delivers it through a process-global `__setBuildManifest()` consumed by the next constructor; the instance API is our correction.)

**Delivery: the manifest travels as code.** `mcp-use build` builds the server bundle from a **generated wrapper entry** — the user's entry plus the views map baked in as inline data (including the full `js`/`css` strings), priming before re-export. The user entry must default-export the `MCPServer` instance — the same entry contract `CLI_SPEC.md` already enforces for `dev` and `start`:

```ts
// .mcp-use/build/index.js (conceptually; generated, never user-visible)
import server from "<bundled user entry>";
import { registerViews } from "mcp-use";
server[registerViews]({
  "product-search-result": { kind: "inline", js: "…", css: "…" },
});
export default server;
```

Because priming happens during module evaluation of the built entry, it is complete before any downstream `getHandler()`/`listen()` call — and because it is part of the JS module graph, every bundler and file tracer (Vercel's nft, esbuild, Wrangler) carries it automatically. Per mode:

- **`start`:** imports the built entry; views are primed by the wrapper before `listen()`. Nothing new in the `start` contract.
- **Serverless:** the function entry imports `.mcp-use/build/index.js` (not the TS source — a views deployment necessarily has a build step, since the inline bundles only exist post-build). Identical code path to `start`; the MCP surface (list/read/tool meta) needs **zero filesystem** at runtime.
- **Dev:** no wrapper — the CLI calls the same internal API on each freshly loaded instance (the module runner constructs a new `MCPServer` per entry reload) before wiring it into the swappable handler, feeding it the in-memory view registry (`kind: "external"`) and `{ dev: true }` so HMR websocket origins are emitted in resource CSP. View add/remove triggers the existing reload-and-swap; view *code* edits never touch registration (pure client HMR). External manifest entries are origin-absolute `/`-prefixed Vite module paths by contract; non-`/`-prefixed paths are rejected (no synthesized asset-URL fallback).

**No fallback, loud errors.** There is deliberately no `fs` path anywhere on the MCP surface and no degraded mode: a tool declaring `view: { name }` on an instance with no primed views — or a name the primed registry doesn't contain — is a mount-time error naming the view and the fix (`run mcp-use build` / deploy the built entry). Cautionary precedent: Skybridge keeps a `readFileSync(manifest)` fallback for when priming was skipped, and it degrades *silently* in exactly the environments where it can't be debugged — serverless bundles that don't include the JSON, or any process whose cwd differs from the build layout; tools keep working, views render blank. That failure class is not made unlikely here; it is made inexpressible.

**Consequence, documented:** views make `mcp-use build` mandatory for deployment. The ships-unbuilt serverless shape (function entry importing the TS source directly, per the current `examples/vercel`) remains valid for tool-only servers; the views variant of the example imports the built entry.

### Serving

All framework HTTP surface lives under **`${basePath}/_mcp-use/`** — a framework-owned namespace inside the one mount point users already expose (underscore prefix = private-by-convention, the `_next` analog; v1's `${basePath}/mcp-use/widgets` naming is dropped). Everything under `basePath` means the existing handler covers MCP + public assets with zero extra routing config on any platform — one Hono app, one serverless function, one exposed path prefix.

Hosts obtain the view document **only** through `resources/read`. Production documents inline the bundle. The MCP Apps spec defines no host flow that navigates an iframe to a server URL; the inspector reads the resource via `resources/read` and renders through `srcdoc`. Unbound views are previewed the same way.

| Route | Serves | Cache-Control |
| --- | --- | --- |
| `GET ${basePath}/_mcp-use/public/<path…>` | static files from the project-root `public/` directory (Public assets, below) | `public, max-age=0, must-revalidate` |

Public responses include `Access-Control-Allow-Origin: *`. Hosts render views in sandboxed cross-origin iframes (`srcdoc`); module scripts and other fetches run in CORS mode, so permissive ACAO on these public static files is required when anything still loads over HTTP (public assets; in **dev**, Vite modules). Dev Vite-served module URLs need the same CORS surface for hosts that fetch them cross-origin: while a tunnel is active they emit `*`; without a tunnel on a localhost bind they reflect a validated loopback `Origin` (exact value + `Vary: Origin`) so a local MCP host can load the module graph, while foreign / opaque / missing Origin get no ACAO and the source module graph stays unreadable to arbitrary websites (CLI_SPEC.md § DNS-rebinding protection).

**Document synthesis** (for `resources/read`) branches on the manifest entry kind:

- **`inline` (production):** emit `<style>` with the CSS (escaping `</style`) and `<script type="module">` with the JS (escaping `</script` → `<\/script` and `<!--` → `\x3C!--`). Keep the `__mcpUseViewConfig` config script (`publicBase` still origin-resolved per request) and `<div id="root">`.
- **`external` (dev):** `<link>` / `<script type="module" src>` tags for Vite module URLs (current HMR path).

**Origin resolution is request-scoped** — applied at `resources/read` emission time:

- **`MCP_URL`** — server public origin (`.origin` only): OAuth resource URL, CSP `connectDomains`, dev HMR websocket host.
- **`MCP_ASSETS_URL`** — assets URL prefix (origin + optional path): view JS/CSS hrefs and `__mcpUseViewConfig.publicBase`. Falls back to `MCP_URL` origin, then `Forwarded` / request origin.
- **CSP env** — `CSP_URLS` (shortcut for all four MCP Apps categories) and `CSP_*_DOMAINS` per-category overrides merge with author `view.csp` before MCP auto-append. Env vars rank above MCP auto-append.

Build-time: when `MCP_ASSETS_URL` is set, manifest asset paths are rewritten to full CDN URLs; upload `.mcp-use/build/views/` to the asset host.

**srcdoc iframes have no document base URL.** Hosts render view documents via `srcdoc`, so every URL the view still loads over the network (public assets; in **dev**, Vite modules) must be absolute — root-relative paths resolve against the *host page* origin, not the MCP server. Production view JS/CSS need no network URLs (inlined). Dev sets Vite `server.origin` to the dev server's browsable origin so imported assets emit absolute `http://…` URLs. Public assets resolve through a request-scoped config global injected into the synthesized document.

**CSP consequence:** hosts sandbox the view iframe and enforce the resource's `ui.csp` from the `resources/read` content item's `_meta.ui` (content-item value takes precedence; the list entry is a static fallback). Authors declare external domains in the binder's `view.csp`; the registration layer **auto-appends the request-derived serving origin** to `csp.resourceDomains` when emitting resource `_meta` on both `resources/list` and each `resources/read` content item so public assets/images from the serving origin remain loadable (production view JS/CSS are inlined and do not need the origin for script/style fetches, but the origin append stays for public assets). Public assets are same-origin with the serving origin and need no extra CSP declaration beyond that append. In **dev** (views primed with `{ dev: true }`), the registration layer also **auto-appends the serving origin's websocket variant** (`http:` → `ws:`, `https:` → `wss:`) to `csp.connectDomains` on both surfaces so Vite HMR passes host `connect-src` — derived from the same per-request origin as `resourceDomains`, never emitted in production. Vite dev's `eval` usage can violate host `script-src`; the MCP Apps CSP shape is origin-lists only and cannot declare an eval allowance, so if strict hosts block it the fix is Vite-side (e.g. jitless deps, no eval-based sourcemaps) — deferred until it bites in practice (Open questions).

### Public assets

v1 parity: authors drop static files in a project-root `public/` directory and reference them from views with root-relative paths (`/fruits/apple.png`). Two mechanisms coexist:

1. **Imported assets** — `import url from "./file.png"` in a view module. Vite inlines them as data URLs in the self-contained production bundle (`assetsInlineLimit`); in dev they resolve through Vite with absolute URLs via `server.origin`.
2. **Public folder** — files under `public/` served at `GET ${basePath}/_mcp-use/public/<path…>`. **Build** copies `public/` → `.mcp-use/build/views/public/`. **Dev** and **start** read from `<projectRoot>/public` (dev) or `.mcp-use/build/views/public/` (production). Missing `public/` → route 404s; nothing breaks. Path traversal (`..`, backslashes) is rejected.

**Runtime resolution.** The synthesized document injects one inline `<script>` before the view module script:

```html
<script>globalThis.__mcpUseViewConfig={"publicBase":"<origin><basePath>/_mcp-use/public/"};</script>
```

`publicBase` is request-scoped (computed per request), not boot-time baked — the v1 mistake of baking origin at startup remains dead. `<Image>` reads this global (the one public consumer; the internal `publicAsset()` resolver is not exported — v1 shipped the same posture, an `<Image>` component over injected globals with no standalone resolver): root-relative `src` values resolve to `${publicBase}<path-without-leading-slash>`; absolute `http(s):` and `data:` URLs pass through; fully-relative paths (no leading `/`) are left alone. Non-`<img>` consumers (CSS backgrounds, `<video>`) can be served by exporting the resolver later — additive, deferred until asked for. `import.meta.url` relative resolution was rejected for public assets because the dev virtual entry URL (`/@id/__x00__virtual:mcp-use/views/<name>`) has no stable sibling `public/` segment — the injected config works identically in dev and production.

### Dev

`mcp-use dev` adds the client environment to the **same Vite dev server** the implemented CLI already runs (`CLI_SPEC.md`'s single process — today it runs the node/SSR environment only, with the Vite server in middleware mode), with its middleware mounted at `${basePath}/_mcp-use/` ahead of the MCP handler. When views exist, Vite `server.origin` is set to the dev server's browsable origin — `http://localhost:<port>` for loopback/wildcard binds, `http://<host>:<port>` otherwise (a wildcard bind address like `0.0.0.0` accepts connections but is not itself a valid request host in every browser) — so imported asset URLs are absolute (srcdoc iframes, Public assets).

- View documents are synthesized per `resources/read` (same shell, `@vite/client` + the virtual entry served through the middleware — `kind: "external"`); assets flow through Vite transform — no build step, no manifest file. Dev documents therefore boot via Vite module fetches (HMR); catching the very start of an argument stream is best validated against a production build (self-contained inline documents). The in-memory view registry plays the manifest's role, kept current by Vite's watcher: add/remove view directories trigger the entry's existing reload-and-swap — a fresh `MCPServer`, re-primed via the internal API (Registration mechanism, above) — never mutation of a running instance. The next `tools/list`/`resources/list` reflects it, and subscribed modern clients are prompted to refetch by the dev server's shared event bus. The `public/` route serves `<projectRoot>/public` directly (Public assets).
- **View-file edits get Vite HMR.** This is the client half of the one dev server: view code is pure browser code, so Vite's own HMR channel applies to it. The server entry keeps `CLI_SPEC.md`'s implemented reload-and-swap contract untouched — its reload-not-HMR rule is about the *server* module graph, and views don't change that. Because hosts enforce the resource's `ui.csp.connectDomains` against the HMR websocket, dev priming (`__primeViews(views, { dev: true })`) auto-appends the request-resolved serving origin's websocket variant to `connectDomains` on both `resources/list` and each `resources/read` content item — same origin derivation as `resourceDomains`, production never emits it (Serving, CSP consequence).
- **HMR means React Fast Refresh, not document reload.** A bare Vite setup has no HMR accept boundary in a view's module graph, so every `view.tsx` edit degrades to `full-reload` — which reloads the srcdoc iframe document and wipes all component state, bridge state, and pending tool results. Three pieces prevent that, all dev-only:
  - **`@vitejs/plugin-react` provides the refresh boundary.** It is a regular framework dependency and is injected exactly once by `mcp-use dev`.
  - **The virtual entry imports the refresh preamble.** Fast Refresh needs its runtime hooked into the window before any component module evaluates — the job plugin-react's `transformIndexHtml` does for Vite-served HTML, which the synthesized srcdoc document never passes through. When refresh is active, each virtual entry's **first** import is the plugin's own virtual preamble module (`@vitejs/plugin-react/preamble`), so the hook is installed before react-dom or any refresh-wrapped view module runs.
  - **The virtual entry self-accepts.** Dev entries end with `import.meta.hot.accept()`, so an update that propagates past the view module (e.g. a non-component export defeating Fast Refresh's self-accept) re-runs the bootstrap — `bootstrapView` reuses the mounted runtime and React root for the same root element (HMR), warns if normalized `viewConfig` changed (full iframe reload required for config changes), and throws if a second root is targeted while one is mounted — instead of escalating to a document reload. Build entries carry neither the preamble import nor the accept call (production output stays inert).
- **Server-entry list invalidation:** after a successful handler swap, dev publishes all three list-change events on the process-scoped SDK bus shared by every handler generation. This is deliberately not a registry diff: modern subscribers refetch authoritative lists from the new stateless handler, while failed reloads publish nothing. Pure view-code edits remain on Vite HMR and do not invalidate server lists; adding or removing a view triggers the server reload path above.
- `view.name` → directory validation (Server API, above) runs at registration in dev and at build in prod — same check, two enforcement points.

### `start` and serverless

`mcp-use start` imports the built wrapper entry — views arrive already primed with inline JS/CSS (Registration mechanism, above) — and serves public assets: no vite, no discovery, no cli chunk (the public route, document synthesis for `resources/read`, and origin resolution live in the runtime package). Serverless targets get the identical code path: the function entry imports `.mcp-use/build/index.js` and `getHandler()` serves the same routes. The MCP surface needs zero filesystem; **public assets are the one remaining fs-shaped thing**, handled per platform: node/`start` reads `.mcp-use/build/views/public/` directly; Vercel functions have a real fs and need only file tracing (one `vercel.json` `includeFiles` line — the views variant of `examples/vercel` ships it); Cloudflare Workers use Workers Static Assets on the public route (or the `nodejs_compat` `/bundle` VFS via module rules). And the escape hatch works everywhere: the origin override + any CDN/static host in front of `${basePath}/_mcp-use/public/` works unmodified.

---

## Typing: `ToolRef` + `Register` (zero codegen)

Exports-based inference is the primary mode; tool typegen is an explicit escape hatch only, never on the dev/build hot path. `dev` and `build` only ensure that the constant root `tools.d.ts` shim exists; they do not inspect tools or generate a registry. The full option space behind this choice (including the rejected alternatives) is preserved in `type_proposals.md`.

### `tool()` return-type change

`tool()` returns `ToolRef<Name, Input, Output>` instead of `this` — a value (`{ name }` at runtime) carrying phantom types read off the existing `InferToolInput`/`InferToolOutput` machinery in `src/tools.ts`. Standard Schema does the inference, so typed views work with zod v4, ArkType, and Valibot alike. Requires a `const` type parameter (`tool<const T extends ToolDefinition>`) so `name` infers as a literal.

This ends `server.tool(…).tool(…)` chaining — an acceptable break: nothing in the repo chains today, chaining without type accumulation is convenience only, type accumulation remains off the table (`SPEC.md` ground rule — `MCPServer` stays non-generic; `resource()`/`prompt()` keep returning `this` until a consumer needs refs), and the official v2 SDK itself returns a handle from `registerTool`.

### How types reach view files

View bundles must never contain server code, so the ref **value** is never imported by a view. The type crosses in type space only:

```ts
// tools.d.ts — scaffolded at the project root; dev/build recreate it if missing
// (the vite-env.d.ts pattern: configuration, not codegen — it lives in the
// source tree because .mcp-use/ is gitignored and rm -rf-safe, CLI_SPEC.md)
declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}
```

```ts
// in /react
export interface Register {}  // filled (or not) by the project's tools.d.ts

type RegisteredToolsModule = Register extends { tools: infer M } ? M : Record<never, never>;

type ToolsFromModule<M> = {
  [K in keyof M as M[K] extends ToolRef<infer N, any, any> ? N : never]:
    M[K] extends ToolRef<any, infer I, infer O> ? { input: I; output: O } : never;
};

type RegisteredTools = ToolsFromModule<RegisteredToolsModule>;
```

Users export the refs of tools views care about (`export const searchFruits = server.tool(…)`) — the module is the registry; no map API, no `export type AppType` ritual, no user-written `declare module`. The name union covers **every exported ref** regardless of `visibility` (a view may call model-visible tools too; `visibility: "app"` declares app-only visibility — the host hides the tool from the model per `_meta.ui.visibility`, not the server). `typeof import()` is a live tsserver edge: add a tool, and every view's `useCallTool` union updates with no process running. Multi-file registration composes via re-exports (`export * from "./tools/fruits.js"`).

`ToolContextHandle` resolves through the same map. The type parameter is the view's single bound tool name (`keyof RegisteredTools`). There is no `toolName` field on any branch — one-to-one binding makes a runtime tool-name discriminant unnecessary:

```ts
/** The bound/called tool ran and answered with `isError: true` — a domain error. */
class ToolError extends Error {
  readonly result: CallToolResult & { isError: true };
  // message derived from text content, or "Tool returned an error."
}

/** What can appear in the error slot of ToolContextHandle. */
type ToolContextError = ToolError;

type ToolContextHandle<Name extends keyof RegisteredTools> =
  | {
      status: "pending";
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      error?: undefined;
    }
  | {
      status: "ready";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: RegisteredTools[Name]["output"];
      content: ContentBlock[] | undefined;
      meta: Record<string, unknown> | undefined;
      error?: undefined;
    }
  | {
      status: "error";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: undefined;
      content: ContentBlock[] | undefined;
      meta: Record<string, unknown> | undefined;
      error: ToolContextError;
    };
```

`useToolContext<Name>()` returns this handle. TypeScript narrowing on `status === "ready"` guarantees complete, typed `toolOutput`. A valid MCP tool error (`isError: true`) yields `status: "error"` with a `ToolError` instance. A content-only non-error result is not classified as invalid because the notification contains no tool identity; it is ignored. Partials from `ui/notifications/tool-input-partial` and complete args from `ui/notifications/tool-input` replace the same pending `DeepPartial<Input>` field.

Keying by tool name (not view directory name) is deliberate: view names exist only in the filesystem/manifest, which type space cannot see without codegen — tool names exist as literal types on exported refs. The type parameter is the author's declaration of which tool delivers results to this view. It is not enforced in type space (a wrong literal compiles against the wrong schema); the runtime binding checks at mount/build (decision 10) are the enforcement. Unbound views (inspector-preview only) never reach `"ready"` — components branch on hook state and declare no required result payload.

**Note for cutover:** the `declare module` specifier must match the published import path — it becomes `"mcp-use/react"` when the package renames. The scaffolded file is the only thing that changes.

### Fallback ladder

1. `useCallTool("name")` — primary; typed via `Register` when the project has `tools.d.ts` and the ref is exported.
2. `useCallTool(toolRef)` — for contexts where the ref value is legitimately in scope (the inline-JSX stretch path); not for file-based views (value import = server code in the bundle).
3. `useCallTool<Args, Result>("name")` — explicit generics for dynamically registered tools (statically untypeable in any framework) and unexported refs.
4. Empty `Register` (no `tools.d.ts`) degrades to `(name: string)` — non-scaffolded projects compile untouched until `dev` or `build` creates the shim.

A forgotten `export const` silently drops that one tool to rung 3/4 — documented habit; a lint rule is a possible follow-up, not alpha scope.

### Typegen, demoted

No command generates tool-specific types during `dev`, `build`, or `start` — v1's run-the-server generator (`tool-registry-generator.ts`, `zod-to-ts.ts`) is not ported. `dev` and `build` perform one constant-file check: if root `tools.d.ts` is absent, they create it with a type-only import of the discovered server entry; an existing file is never overwritten. `mcp-use typegen` (+ `mcp-use check` for CI freshness) remains the explicit secondary mode, for consumers with no compile-time path to the server source; if/when built, it is a TS-checker-based static extractor (reads resolved `ToolRef` types; never executes user code), defaulting output to `.mcp-use/generated/`. Not an alpha deliverable.

The v2 `create-mcp-use-app` MCP Apps template is the reference for the root `tools.d.ts` + exported-refs pattern.

---

## React runtime (`/react` subpath)

`mcp-use/react` is browser-only code built on the ext-apps guest `App` (one instance per iframe document, connected once via `PostMessageTransport`); `react` and `react-dom` are optional peers; importing the subpath from server code is unsupported. The v1 hook *surface* is kept (renamed); the v1 transport guts (three-provider selection, `window.openai` branch, hand-rolled `McpAppsBridge`) are not.

### Runtime architecture

Ownership splits three ways:

- **`McpAppRuntime`** — one eagerly created ext-apps `App`, one cached `connect()` promise, capabilities, snapshots (tool / host / theme / display channels), stable actions, and deterministic disposal. Initialization failure is exposed through host runtime state and is terminal for the mount: later `connect()` calls return the same rejected promise, never create a new App, and never reconnect. Each runtime owns one `ModelContextStore`.
- **ext-apps `App`** — MCP Apps protocol behavior (handshake, events, outbound methods, tool registry).
- **React hooks** — subscribe to narrow external-store channels via `ViewRuntimeContext` (no default singleton). Hooks used outside a bootstrap-mounted view throw: `mcp-use/react hooks require a browser view mounted by bootstrapView`.

**Bootstrap** (`bootstrapView(viewModule)`):

1. Validate the browser environment.
2. Read and normalize `viewModule.viewConfig` (reject invalid, empty, duplicated, or non-inline-containing `displayModes`).
3. Create the runtime and App (with normalized `autoResize` / `availableDisplayModes`); install temporary empty tool handlers (see View tools).
4. Start `runtime.connect()` (attach a rejection handler immediately).
5. Create the React root and render under a top-level error boundary + `ViewRuntimeProvider`.

React mounts immediately after connection starts — the component renders in pending state during the handshake. One App per iframe document: a second root throws; repeated bootstrap for the same root reuses the mounted runtime and App (HMR) without another connection attempt and warns if normalized config changed (full iframe reload required for config changes). A failed initialization does not automatically retry; a fresh mount requires disposal/rebootstrap (normally a full iframe reload). Disposal unmounts React before closing the App (so hook cleanup can remove view tools while the connection still exists) and clears the mount record, permitting fresh rebootstrap.

Capability checks are centralized in the runtime: `callServerTool` requires host `serverTools`; `sendFollowUp` requires message support; `openExternal` requires `openLinks`; `requestDisplayMode` rejects modes outside the negotiated intersection of normalized `viewConfig.displayModes` and `hostContext.availableDisplayModes` (host omits modes → only `"inline"`). Size notifications have no capability guard (the MCP Apps draft defines none).

Individual action hooks return stable runtime-owned methods — there is no aggregate `useViewActions`.

### Component lifecycle & view data

The generated iframe entry — not user code — bootstraps the runtime and mounts the default export once; the component stays mounted for the iframe lifetime. No props are spread onto it.

**Mount timing.** The default export renders as soon as bootstrap starts the connection — before any tool result — and remains mounted through progressive input, result delivery, and subsequent re-renders. There is no separate loading component export and no component swap; the pre-result window is handled inside the component by branching on `useToolContext<Name>()` state.

**Primary data hook: `useToolContext<Name>()`.** Returns a discriminated union `ToolContextHandle<Name>`:

- **`status: "pending" | "ready" | "error"`** is the discriminant.
- **`"pending"`:** no terminal rendering result yet. Partial and complete input notifications replace one `DeepPartial<Input>` `toolInput` snapshot (provisional, render-only — strings may be truncated mid-token).
- **`"ready"`:** a non-error result with `structuredContent` arrived; `toolOutput` = that tool's output type (from `outputSchema`, via `Register`/`RegisteredTools`); `content` = result `content` blocks; `meta` available (the view-only result channel); `toolInput` is the complete args when delivered.
- **`"error"`:** the first `isError: true` result → `error: ToolError`. `toolOutput` is always `undefined`; `content` / `meta` may still be present.

TypeScript narrowing on `status === "ready"` guarantees complete `toolOutput` — this replaces the old guarantee that a component signature implied complete result data. Tool errors are never cast to typed output.

**Status transitions and latch.** While pending, input notifications replace `toolInput`. The first non-error result carrying `structuredContent` transitions to `"ready"`; the first `isError: true` result transitions to `"error"`. A content-only success and a cancellation leave the context pending. Ready and error are terminal for the iframe: every later lifecycle notification is ignored.

The draft notification contains no tool name or request id. Before latching, the runtime therefore assumes the first structured result or tool error belongs to the rendering invocation. This pending-period ambiguity is deliberate; no schema matching, private metadata, or timing heuristic is added. The terminal latch prevents the common later `useCallTool` and `useViewTool` notifications from replacing the rendered View data.

Canonical authoring pattern:

```tsx
export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  return <ResultsGrid items={view.toolOutput.items} />;
}
```

**Result delivery.** The first structured success transitions the handle to `"ready"`; later results never replace it. The payload is exactly `structuredContent` — no v1-style merge of `toolInput` into tool output.

**Unbound views** (warned at mount — decision 10) mount and run hooks but never reach `"ready"` if nothing delivers a tool result (inspector preview via `resources/read`); such components branch on hook state and don't assume result payload.

Components compose the split hooks they need — no aggregate; rerender isolation by design (tool / host / theme / display channels are separate snapshots).

### Streaming

Two distinct things can stream, and only one of them exists on the wire today:

**1. Tool *arguments* stream — supported** (spec: `ui/notifications/tool-input-partial`). Hosts deliver progressively parsed arguments while the model is still generating the call — the pre-result window. Partials fire 0..n times strictly before the single complete `ui/notifications/tool-input`. The always-mounted component reads this through `useToolContext<Name>()` — both partial and complete args write the same `toolInput` field (last write wins):

```tsx
export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  return <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />;
}
```

While pending, `toolInput` is `DeepPartial<Input>` because either notification may expose provisional JSON. Each partial or complete notification replaces the previous snapshot. The deliberate type-source split remains: `toolInput` types from the tool's `inputSchema`; `toolOutput` from its `outputSchema`.

**"Streaming tool output" (the generative-UI recipe).** When the thing to render *is* what the model is writing (a drawing, generated UI code, long-form content — the Excalidraw MCP app pattern), put that payload in the tool's **input** schema and render it progressively via `toolInput` inside the single always-mounted component. The final `"ready"` state shows the same visual surface with complete, honestly-typed data from `toolOutput` — no echo-input-into-output workaround is needed for the pre-result window:

```ts
// server — the model streams `elements` while writing the call
export const draw = server.tool(
  {
    name: "draw",
    inputSchema: z.object({ elements: z.array(elementSchema) }),
    outputSchema: z.object({ elements: z.array(elementSchema) }),
    view: { name: "canvas" },
  },
  async ({ elements }) => ({
    content: [{ type: "text", text: `Drew ${elements.length} elements` }],
    structuredContent: { elements },
  })
);
```

```tsx
// resources/canvas/view.tsx — one component, one mount, progressive then complete
export default function Draw() {
  const view = useToolContext<"draw">();
  const elements =
    view.status === "ready"
      ? view.toolOutput.elements
      : (view.toolInput?.elements ?? []);
  return <Canvas elements={elements} streaming={view.status === "pending"} />;
}
```

Schema guidance that falls out: **declare streamable payloads as structured schema, not JSON-in-a-string.** Hosts heal the *outer* argument JSON, so a `z.array(...)` field arrives as a partial array of typed elements; a stringified payload arrives truncated mid-token and the view must re-heal it by hand (the shipped Excalidraw app pays exactly that cost). Because the component never unmounts across pending → ready, DOM and React state built during progressive input survive the transition.

**2. Tool *results* do not stream — wire fact, honest alpha posture.** The protocol delivers one `ui/notifications/tool-result` per call. `useCallTool` owns its direct RPC response; the host may also forward that lifecycle result to the displayed View. Content-only ambient results are ignored, and the terminal initial-result latch prevents later structured results from becoming new `toolOutput`.

### View tools (`useViewTool`)

The apps spec lets the *view* expose tools the **host/model** calls while the view is displayed (ext-apps `App.registerTool` → `RegisteredAppTool`, WebMCP-style; Linear MCP-2309). This is the third tool flavor — keep the taxonomy straight:

| Flavor | Registered by | Called by | Lifetime |
| --- | --- | --- | --- |
| server tool | `server.tool()` | model (via host) | server process |
| server tool, app-visible | `server.tool({ visibility: "app", … })` | the view, via `useCallTool` | server process; host hides from the model per `_meta.ui.visibility` |
| **view tool** | `useViewTool` inside the component | host/model over the bridge | while the component is mounted |

View tools are ephemeral, conversational UI affordances whose handlers close over live React state ("highlight-fruit", "pan-map"). The hook mirrors `server.tool(definition, callback)` — same config keys (`name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, plus `enabled`; `schema` aliases `inputSchema`), handler args inferred via Standard Schema, return typed by the same `ToolResult<Output>` conditional as server tools (raw `CallToolResult`):

```tsx
const [selected, setSelected] = useState<string | null>(null);

useViewTool(
  { name: "highlight-fruit", description: "Highlight a visible result", inputSchema: z.object({ id: z.string() }) },
  async ({ id }) => {
    setSelected(id);
    return { content: [{ type: "text", text: `Highlighted ${id}` }] };
  }
);
```

Contract:

- **React lifecycle = tool lifecycle.** Register synchronously on mount against the runtime-owned App, independently of whether the single connection attempt is pending, fulfilled, or rejected. Registration is keyed by `name`; `remove()` runs on unmount, `update()` applies in place when `title`/`description`/`annotations` change (pass explicit `undefined` so metadata can be cleared), and `enabled: false` calls `disable()` without unmounting (a disabled tool stays registered but is not listed/callable). Ext-apps emits `tools/list_changed` automatically after initialization, so the host's tool list always matches the mounted UI (strict-mode double-mount is safe: remove + re-register). `inputSchema`/`outputSchema` are captured at registration time — inline `z.object(...)` literals in the definition never re-register the tool per render (ext-apps fixes the handler's arity at registration anyway); changing a tool's schema means registering under a new name. `schema` is accepted as an alias for `inputSchema`. Registration goes through `runtime.registerViewTool()` rather than calling `app.registerTool()` directly.
- **Latest-closure handler:** the registered callback delegates through a per-render ref (`useEffectEvent` pattern) — handlers always see current state, no re-registration per render. Capture the registered handle inside the effect so an old cleanup cannot remove a newer registration.
- **Always-advertised App tools:** every view runtime eagerly creates its App, advertises `tools: { listChanged: true }`, and installs temporary handlers before `connect()` starts or React mounts: `onlisttools` returns `{ tools: [] }`; `oncalltool` throws `View tool "<name>" is not registered`. When `useViewTool` registers the first tool, the runtime synchronously clears the temporary handlers and calls `app.registerTool()` (the clear-and-register handoff is synchronous so the host never observes a handler gap; clearing first avoids ext-apps' "handler replaced" warning), after which ext-apps' registry-backed handlers own the surface and `notifications/tools/list_changed` is emitted once initialized. No `viewTools` opt-in flag exists. Before the first registration, `tools/list` is valid and empty. Because registration never awaits `connect()`, tools are present for initialization-time listing/calls and are not skipped when initialization fails.
- **Not in `Register`:** view tools never appear on the server's `tools/list` and are never callable from views — typing them into `useCallTool` would advertise calls nobody can make. Their input/output types live and die inside the component.
- **Progressive enhancement only:** no host capability promises app-tool support; hosts that support it list/call, others ignore. Registration is unconditional and cheap; views must not depend on view tools being invoked.
- **Channel note:** a view tool's result (`content`/`structuredContent`) flows host→model — the third explicit view→model channel (alongside `updateModelContext` and `ui/message`), distinguished by being *model-initiated*.

### `/react` API reference

The complete alpha surface. Everything here is exported from `mcp-use/react`; types marked *vendored* alias the ext-apps `spec.types.ts` definitions (carried with attribution, per the dependency posture).

**Types.**

```ts
/** Augmented by the project's tools.d.ts; empty by default. */
interface Register {}

/** Pre-render runtime configuration — optional named export from a view module. */
interface ViewConfig {
  /**
   * Let ext-apps observe the document and report size changes.
   *
   * @defaultValue true
   */
  autoResize?: boolean;

  /**
   * Display modes this view can render correctly.
   *
   * Must contain "inline".
   *
   * @defaultValue ["inline", "fullscreen", "pip"]
   */
  displayModes?: readonly DisplayMode[];
}

/** The bound/called tool ran and answered with `isError: true` — a domain error. */
class ToolError extends Error {
  readonly result: CallToolResult & { isError: true };
  // message derived from text content, or "Tool returned an error."
}

/** What can appear in the error slot of ToolContextHandle. */
type ToolContextError = ToolError;

/** Discriminated union returned by useToolContext<Name>(). */
type ToolContextHandle<Name extends keyof RegisteredTools> =
  | {
      status: "pending";
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      error?: undefined;
    }
  | {
      status: "ready";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: RegisteredTools[Name]["output"];
      content: ContentBlock[] | undefined;
      meta: Record<string, unknown> | undefined;
      error?: undefined;
    }
  | {
      status: "error";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: undefined;
      content: ContentBlock[] | undefined;
      meta: Record<string, unknown> | undefined;
      error: ToolContextError;
    };

/** Recursive partial for streamed JSON: every field optional at every depth.
 *  Arrays may be shorter than final; string values may be truncated mid-token.
 *  Provisional, render-only data — never act on it. */
type DeepPartial<T> = T extends (infer E)[]
  ? DeepPartial<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Successful non-error tool result. structuredContent is guaranteed and
 *  typed exactly when the tool declares an outputSchema (Result ≠ never). */
type CallToolSuccess<Result> = CallToolResult &
  { isError?: false } &
  ([Result] extends [never] ? unknown : { structuredContent: Result });
```

**`useToolContext<Name>()`** — primary data hook. Returns the latched `pending | ready | error` `ToolContextHandle<Name>` (Component lifecycle & view data). Narrow on `status === "ready"` for typed `toolOutput`; `"error"` contains `ToolError`.

```ts
function useToolContext<Name extends keyof RegisteredTools>(): ToolContextHandle<Name>;
```

**Helpers**

```ts
/** Concatenated text content of a tool result, or undefined when it has none. */
function toolResultText(result: Pick<CallToolResult, "content">): string | undefined;
```

Joins the `text` of every `content` block with `type === "text"` using `"\n"`, then trims. Returns `undefined` when there are no text blocks or the joined result is empty/whitespace — callers choose their fallback. A general data-reading utility for any `CallToolResult`; `ToolError.message` is derived the same way (with a non-empty fallback).

**Environment hooks** — split subscriptions; each rerenders only when its channel updates.

```ts
function useHostContext(): {
  theme: "light" | "dark";
  locale: string;
  timeZone: string;
  userAgent: string;
  displayMode: "inline" | "fullscreen" | "pip";
  safeArea: SafeAreaInsets;
  maxHeight: number | undefined;
  maxWidth: number | undefined;
  hostInfo: HostInfo | undefined;         // getHostVersion()
  hostCapabilities: HostCapabilities | undefined; // getHostCapabilities()
  hostContext: HostContext | undefined;   // the raw object (vendored type)
  isAvailable: boolean;                   // bridge connected
};

function useViewTheme(): "light" | "dark"; // narrow theme-only subscription
```

**Action hooks** — one hook per concern; stable function identities owned by the runtime.

```ts
function useCallTool<Name extends keyof RegisteredTools>(name: Name):
  CallToolHandle<RegisteredTools[Name]["input"], RegisteredTools[Name]["output"]>;
function useCallTool<R extends ToolRef<string, unknown, unknown>>(ref: R): /* same, from the ref */;
function useCallTool<Args extends Record<string, unknown>, Result = unknown>(name: string):
  CallToolHandle<Args, Result>;

interface CallToolHandle<Args, Result> {
  callTool: (args: Args) => Promise<CallToolSuccess<Result>>;
  data: CallToolSuccess<Result> | undefined; // last successful result only (preserved across pending/failed calls)
  error: Error | undefined;   // ToolError | transport/RPC/capability Error (reset on next call)
  isPending: boolean;         // a call is in flight
}

function useSendFollowUp(): (args: { prompt: string }) => Promise<void>;  // ui/message — triggers a model turn
function useOpenExternal(): (args: { url: string }) => Promise<void>;   // App.openLink — requires host openLinks
function useSendSizeChanged(): (size: {
  width?: number;
  height?: number;
}) => Promise<void>;                                                    // App.sendSizeChanged — ui/notifications/size-changed
function useDisplayMode(): {
  displayMode: "inline" | "fullscreen" | "pip";
  availableDisplayModes: readonly DisplayMode[]; // intersection of viewConfig.displayModes and host available modes
  requestDisplayMode: (args: { mode: DisplayMode }) => Promise<void>;
};
```

**`useCallTool` result contract.** Every non-error result **resolves** and populates `data`. `structuredContent` is present and typed exactly when the tool declares an `outputSchema` — the server (via the official SDK) rejects non-error results from schema-backed tools that lack it, so a resolved result from a schema'd tool always carries it; tools without an `outputSchema` legitimately return content-only results (`Result = never`, no `structuredContent` guarantee). Rejections populate `error`:

1. **`ToolError`** — the tool answered with `isError: true` (domain error; previous `data` preserved).
2. **Transport / RPC / capability `Error`** — host lacks `serverTools`, network/RPC failure, etc.

The hook preserves previous successful `data` while a request is pending or fails. Only the latest direct call updates `useCallTool` state. A compliant host may additionally forward that call through the ambient lifecycle notifications; the latched `useToolContext` ignores it after the rendering result arrives.

**`requestDisplayMode` resolves `void` by design** — the underlying `App.requestDisplayMode` returns the granted mode, but surfacing it would create a second source of truth that invites stashing the mode in state, where it goes stale the moment the host changes modes on its own (user exits fullscreen, mobile reflow). The hook's `displayMode` subscription is the single source of truth for the outcome; a denied request (or a mode outside `availableDisplayModes`) simply leaves it unchanged / rejects. `availableDisplayModes` is the intersection of normalized `viewConfig.displayModes` (always includes `"inline"`) and `hostContext.availableDisplayModes`; if the host omits available modes, only `"inline"` is requestable.

**`useSendSizeChanged()`** — manual size reporting for the host iframe. Auto-resize is on by default (ext-apps measures the document under `height: max-content` and sends `ui/notifications/size-changed`). Views whose height derives from their width — for example a fixed aspect-ratio container sized via `ResizeObserver` — measure ~0 under that strategy and the host collapses the iframe. Opt out with `viewConfig.autoResize: false`, then call `useSendSizeChanged()` with `{ width, height }` from a container observer (or equivalent):

```tsx
import {
  ThemeProvider,
  useSendSizeChanged,
  type ViewConfig,
} from "mcp-use/react";
import { useEffect, useRef } from "react";

export const viewConfig = {
  autoResize: false,
  displayModes: ["inline", "fullscreen"],
} satisfies ViewConfig;

export default function AspectRatioView() {
  return (
    <ThemeProvider>
      <AspectRatioContent />
    </ThemeProvider>
  );
}

function AspectRatioContent() {
  const ref = useRef<HTMLDivElement>(null);
  const sendSizeChanged = useSendSizeChanged();

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      void sendSizeChanged({ width, height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [sendSizeChanged]);

  return <div ref={ref} style={{ width: "100%", aspectRatio: "4 / 3" }} />;
}
```

**`useViewTool(definition, handler)`** — view-registered tools (contract above). `definition` mirrors `ToolDefinition` plus `enabled?: boolean`; the handler's params/return are inferred exactly like a server tool's. No configuration flag is required.

**Local UI state is plain React `useState`** — there is deliberately no `useViewState` wrapper. MCP Apps has no host-persisted view store (see "Dropped from v1"), so a dedicated hook would only restate `useState` while implying persistence that does not exist. State the model should see is an explicit act via `ModelContext`.

**`<ModelContext content={string}>{children?}</ModelContext>`** and **`modelContext.set/remove/clear`** — the explicit view→model channel over `ui/update-model-context` (ext-apps `App.updateModelContext`). Each `McpAppRuntime` owns one `ModelContextStore`; React components obtain the store from runtime context. The imperative `modelContext` API delegates to the active document runtime and throws when no view runtime is mounted. Components register text in a parent-child tree; nested `<ModelContext>` elements serialize as an indented markdown list forming a single text content block. An empty parent (`content` trimmed empty) does not orphan children — it passes the grandparent id through. The imperative `modelContext` API covers non-React call sites (event handlers, stores) with stable string keys: `set(key, string)` joins the text tree as a root node, `remove(key)` clears that key, and `clear()` drops every entry. Each push carries the complete current context — matching the spec's overwrite semantics ("each request overwrites the previous context sent by the View"); the host may defer delivery until the next model turn. Siblings serialize in registration order (React mounts siblings in document order, so the list tracks what's on screen — not `useId` string sort order). Delivery uses an async flush pump: sends are acknowledged only on success; failed update requests stay dirty and retry on the next mutation; in-flight updates coalesce to the latest payload; capability absence does not mark the payload acknowledged; disposal invalidates in-flight completion. A failed runtime initialization is terminal and is not a reconnect trigger. Nothing is pushed until the first non-empty context registers: views that never use `ModelContext` send no `ui/update-model-context` traffic at all, and an empty push is delivered only as an explicit clear after context was previously delivered. Pushes are gated on the host's `updateModelContext` capability (draft) — hosts that don't declare it get no requests, with a single console warning naming the gap. **Deferred** (pending the state-management design): `structuredContent` on the push, non-text `ContentBlock`s, and any coupling to a future `useViewState` / host-persisted store.

**`useViewTheme(): "light" | "dark"`** — narrow theme-only subscription; rerenders only on host theme changes. `ThemeProvider` subscribes to the host style channel (theme, variables, fonts).

**Providers and components.** Bootstrap owns the essentials — runtime connection, always-mounted default export, a top-level error boundary, and default-on auto-resize via normalized `viewConfig` — so **no aggregate provider is required** for the defaults. Users compose optional presentation behavior directly:

```tsx
export default function View() {
  return (
    <ThemeProvider>
      <ViewControls debugger>
        <Dashboard />
      </ViewControls>
    </ThemeProvider>
  );
}
```

Users may add `StrictMode` or another error boundary if their application needs one. `<ThemeProvider>` applies host style variables/fonts (ext-apps `applyDocumentTheme`/`applyHostStyleVariables`/`applyHostFonts`); `<ViewControls>` is the dev-only overlay (v1's `WidgetControls`, renamed); `<ErrorBoundary>` is carried unchanged; `<ModelContext>` annotates model-visible text context (above); `<Image>` resolves root-relative `src` paths against the request-scoped `__mcpUseViewConfig.publicBase` injected into the synthesized document (Public assets).

### Putting it together — a complete view

Reference sketch exercising the full surface (the `examples/views/basic` example follows this shape). Server side, the running example plus one more exported tool (viewless — called from the view via `useCallTool`):

```ts
// src/index.ts (server) — refs exported so Register picks them up
export const searchFruits = server.tool(/* the running example above */);

export const getFruitDetails = server.tool(
  {
    name: "get-fruit-details",
    inputSchema: z.object({ fruit: z.string() }),
    outputSchema: detailsSchema, // e.g. z.object({ name: …, producer: …, nutrition: … })
  },
  async ({ fruit }) => {
    const details = await lookup(fruit);
    return {
      content: [{ type: "text", text: JSON.stringify(details) }],
      structuredContent: details,
    };
  }
);
```

```tsx
// resources/product-search-result/view.tsx
import { useState } from "react";
import { z } from "zod";
import {
  ModelContext,
  ThemeProvider,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewTool,
} from "mcp-use/react";

export default function ProductSearchResult() {
  return (
    <ThemeProvider>
      <SearchResultContent />
    </ThemeProvider>
  );
}

function SearchResultContent() {
  const view = useToolContext<"search-fruits">();
  const { theme } = useHostContext();
  const { displayMode, availableDisplayModes, requestDisplayMode } = useDisplayMode();
  const sendFollowUpMessage = useSendFollowUp();
  const openExternal = useOpenExternal();

  // local UI state (iframe lifetime; not host-persisted — make model-visible via ModelContext)
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // server tool call from the view — name + args/result typed via Register
  const details = useCallTool("get-fruit-details");

  // view tool — the model can manipulate this UI while it is on screen
  useViewTool(
    { name: "highlight-fruit", description: "Highlight a visible result", inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => {
      setSelected(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  const { query, items } = view.toolOutput;

  return (
    <div data-theme={theme}>
      <ModelContext
        content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`}
      />

      <ResultsGrid
        items={items}
        selected={selected}
        onFavorite={(id) => setFavorites([...favorites, id])}
        onDetails={(fruit) => {
          void details.callTool({ fruit });
        }}
        onOpenProducer={(url) => {
          void openExternal({ url });
        }}
      />

      {details.isPending && <Spinner />}
      {details.error && (
        <ErrorBanner message={details.error.message} />
      )}
      {details.data && (
        <DetailsCard data={details.data.structuredContent} />
      )}

      {availableDisplayModes.includes("fullscreen") && displayMode === "inline" && (
        <button
          type="button"
          onClick={() => {
            void requestDisplayMode({ mode: "fullscreen" });
          }}
        >
          Expand
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void sendFollowUpMessage({ prompt: "Compare my favorite fruits" });
        }}
      >
        Compare favorites
      </button>
    </div>
  );
}
```

Everything result-shaped enters through `useToolContext` (typed by the server's `outputSchema`; `query` is there because the handler echoes it for model visibility); everything ambient or imperative goes through split hooks; the view→model paths (`ModelContext`, `sendFollowUpMessage`, view-tool results) are visible and explicit in the JSX. For tools not in the `Register` (dynamic registration, unexported refs), the explicit-generics rung applies with hand-written types: `useCallTool<{ fruit: string }, { name: string; producer: string }>("get-fruit-details")`.

### Hook surface (v1 → v2 → backing primitive)

| v1                                                                                                      | v2                                                                                        | Backed by                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useWidget()`                                                                                           | split hooks (no aggregate)                                                                | `App` events + `getHostContext()`                                            |
| — `props` / `toolInput` / `output`                                                                      | `useToolContext()` primary (`status` discriminant incl. `error`; `output` folds into `toolOutput`; args stream into `toolInput`) | `ontoolinput` / `ontoolinputpartial` / `ontoolresult`                        |
| — `metadata`                                                                                            | `meta` on `useToolContext` when `ready` or `error` — view-only result channel             | result `_meta` from `ontoolresult`                                           |
| — `partialToolInput` / `isStreaming`                                                                    | pending `toolInput` on `useToolContext` (`DeepPartial`; last write wins)                  | `ontoolinputpartial` / `ontoolinput`                                         |
| — `isPending`                                                                                           | `useToolContext().status === "pending"` (or pre-result / error branching)                 | input-received-but-no-result / pre-result state                              |
| *(no v1 equivalent)*                                                                                    | `useToolContext().status === "error"` + `ToolError`                                       | first `ontoolresult` with `isError: true`                                    |
| — `theme` / `locale` / … / `isAvailable`                                                                | `useHostContext()`; `useViewTheme()` for theme-only                                       | `hostContext` + `onhostcontextchanged`                                       |
| — `callTool`                                                                                            | `useCallTool()` (typed; preferred)                                                        | `App.callServerTool`                                                         |
| — `sendFollowUpMessage`                                                                                 | `useSendFollowUp()`                                                                       | `App.sendMessage` (`ui/message`)                                             |
| — `openExternal`                                                                                        | `useOpenExternal()` → `Promise<void>`                                                     | `App.openLink`                                                               |
| — `requestDisplayMode` / `displayMode`                                                                  | `useDisplayMode()` → `{ displayMode, availableDisplayModes, requestDisplayMode }`         | `App.requestDisplayMode` + `hostContext` + `viewConfig.displayModes`         |
| `<McpUseProvider autoSize>` (v1)                                                                        | `viewConfig.autoResize` + `useSendSizeChanged()`                                          | `App` `autoResize` constructor option + `App.sendSizeChanged`                |

| `useWidgetProps()`                                                                                      | `useToolContext()` — primary data API                                                       | bridge notifications → discriminated union                                   |
| `useWidgetState()`                                                                                      | dropped — plain `useState` for local UI state; `ModelContext` for model visibility        | no host store in MCP Apps — see "Dropped from v1"                            |
| `useWidgetTheme()`                                                                                      | `useViewTheme()`                                                                          | dedicated `hostcontextchanged` subscription                                  |
| `useCallTool(name \| ref)`                                                                              | kept, typed via `Register`/`ToolRef`; success-only `CallToolSuccess` data (typed `structuredContent` iff `outputSchema`); tool/transport errors reject | `App.callServerTool`                                                         |
| *(no v1 equivalent)*                                                                                    | `useViewTool()` — view-registered tools the host/model calls (see View tools)             | `App.registerTool` + temporary-handler handoff + `tools/list_changed`        |
| `<McpUseProvider>` (v1)                                                                                 | removed — compose `ThemeProvider` / `ViewControls` / own boundaries; bootstrap owns connection + top-level error boundary | `viewConfig` for auto-resize / display modes                                 |
| `<ThemeProvider>`                                                                                       | kept                                                                                      | ext-apps `applyDocumentTheme` / `applyHostStyleVariables` / `applyHostFonts` |
| `<WidgetControls>`                                                                                      | `<ViewControls>`                                                                          | dev-only overlay, ported                                                     |
| `<ModelContext>` / `modelContext`                                                                       | kept (text-only; `structuredContent` / non-text blocks deferred; runtime-owned store + async flush pump) | `App.updateModelContext` (`ui/update-model-context`)                         |
| `<ErrorBoundary>`                                                                                       | kept (bootstrap provides the required top-level boundary)                                 | unchanged                                                                    |
| `<Image>`                                                                                               | kept — resolves root-relative `src` via `__mcpUseViewConfig.publicBase` (Public assets)   | `<img>` with absolute URL                                                    |
| `generateHelpers()`                                                                                     | dropped                                                                                   | subsumed by `Register` typing                                                |

### Dropped from v1 (spec gaps)

- **`useFiles()` (upload):** file upload does not exist in MCP Apps (upstream: "not yet implemented"); it is a ChatGPT-only `window.openai` extension. Dropped from the alpha; host-mediated *download* (`ui/download-file`, draft) may land later.
- **Cross-session view state:** `window.openai.setWidgetState`'s host-persisted-and-restored state has no spec equivalent, so there is no state hook at all — local UI state is plain React `useState` (iframe lifetime), and a `useViewState` wrapper would only restate it while implying a host store that does not exist. Model visibility is a separate, explicit act via `ModelContext`/`updateModelContext` — v1's conflation of "UI state" and "model context" in one `setState` is deliberately split. Extending `ModelContext` with `structuredContent`, non-text content blocks, or coupling to a future persistence hook is deferred with that state-management design.
- **`_meta.openai/*` emission** (`outputTemplate`, `widgetCSP`, invocation strings, …): overlay territory, out of the alpha (see Protocol posture).

---

## CLI integration

The full build/serve contract is "Build system & serving", above; it extends the **implemented** `CLI_SPEC.md` (which scoped views out) and its ground rules hold — reload-not-HMR for the server entry, `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk. Command summary:

- **`mcp-use dev`:** ensures root `tools.d.ts` exists without overwriting it, then adds the Vite client environment to the existing dev server; public assets and Vite module graph serve through its middleware at `${basePath}/_mcp-use/`. View-file edits get Vite's own HMR (pure client code, sharing the one Vite dev server); server-entry edits follow the existing reload contract and invalidate all three primitive lists over the shared SDK event bus (decision 12). No tool-inspecting typegen hook runs.
- **`mcp-use build`:** ensures root `tools.d.ts` exists without overwriting it, then runs one client-environment build over all views into `.mcp-use/build/views/`; writes the manifest `views` map (tooling copy) and bakes it into the generated wrapper entry (runtime copy — Registration mechanism); runs the binding checks (missing view, missing `outputSchema`, duplicate view binding → errors naming both tools; unbound view → warning).
- **`mcp-use start`:** imports the built wrapper entry (views arrive primed) and serves public assets; no vite, no discovery, no runtime manifest read. View documents are obtained only through `resources/read`.

## Testing

- **Type-level** (`tests/type-level.test.ts` pattern): `ToolRef` name/input/output inference incl. non-zod Standard Schema libs; `ToolsFromModule` filtering and re-export composition; `useCallTool` name union + arg/result types and `CallToolSuccess` success-only data (`structuredContent` typed iff the tool declares an `outputSchema`; no guarantee for schema-less tools); empty-`Register` fallback; `structuredContent` vs `outputSchema` agreement at the return position; `useToolContext` `pending | ready | error` narrowing (`pending` → `DeepPartial` input, `ready` → typed `toolOutput`, `error` → `ToolError`; no `toolName`); input-schema vs output-schema type-source split; `DeepPartial` over arrays/nested objects; string / `ToolRef` / explicit-generic `useCallTool` overloads share the same result contract.
- **e2e over HTTP** (official client): view resource listing/reading with correct mimetype and framework auto-CSP in `_meta.ui.*` on both `resources/list` entries and `resources/read` content items for all clients; `tools/list` includes every registered tool for all clients (including `visibility: "app"` tools with `_meta.ui.visibility: ["app"]`); `ui.visibility` emitted only when top-level `visibility` is set (any tool); custom tool definition `_meta` coexists with generated view/visibility metadata, framework-owned collision values follow the declared contract, caller objects are not mutated or prototype-polluted, and per-request SDK reconstruction does not leak metadata between concurrent requests; **channel separation** — handler `{ structuredContent, content, _meta }` lands on the wire as `structuredContent` / `content` / `_meta` respectively, with handler `_meta` absent from everything model-facing; `_meta.ui.resourceUri` (plus legacy flat `"ui/resourceUri"`) auto-stamped on every non-error view-bound tool result; error results carry no resource-URI stamp; no custom tool-name metadata on results.
- **Build/serve** (CLI-test pattern from `tests/cli/`, real `build` against a views fixture): manifest `views` map shape; the built wrapper entry primes registration with zero `fs` on the MCP path (list/read succeed with the built assets dir absent); the public route under `${basePath}/_mcp-use/public/` with correct cache headers and ACAO; document and assets HTTP routes are gone; per-request origin resolution (proxy headers, override) reflected in the `resources/read` body and content-item `_meta.ui.csp.resourceDomains`; serving origin auto-appended to `csp.resourceDomains`; the binding checks — `view.name` naming a missing view, a `view:` tool without `outputSchema`, and a second tool binding an already-bound view fail loudly naming both tools; a view directory no tool binds warns (build still succeeds, view still registered and readable via `resources/read`); external manifest entries reject non-`/`-prefixed paths.
- **Bridge-level / runtime:** a minimal `AppBridge` drives initialize; progressive partial and complete inputs replacing pending `toolInput`; first structured result latching `ready`; first tool error latching `error`; content-only success and cancellation leaving pending unchanged; every notification ignored after terminal latching; direct `useCallTool` and `useViewTool` responses followed by compliant host lifecycle notifications; schema-backed View-tool validation and schema-less `{}` callback adaptation; capability checks; split-channel rerender isolation; View-tool registration lifecycle; bootstrap/disposal; model context; and size reporting.

## Deltas vs v1 (for the migration guide)

1. Every `widget` name → `view` (`widget:` config, `useWidget*`, `WidgetControls`, `ui://widget/…` → `ui://views/…`). The v1 `widget()` response helper is dropped — handlers return plain `CallToolResult`.
2. `useWidgetProps()` → latched `useToolContext()` (`pending | ready | error`; partial and complete args share a `DeepPartial` pending `toolInput`); `useWidget()` → split data, host, and action hooks. Components mount once. The first structured result becomes typed `toolOutput`; content-only ambient successes are ignored; `ToolError` owns the error branch.
3. View files default-export the component and may export immutable `viewConfig` (auto-resize / display modes). Result types come from `outputSchema` via `useToolContext<Name>()` (required on view-bound tools). Resource facts (description, CSP, permissions, domain, prefersBorder) are declared on the single binder's `view:` config and emitted on the resource. Each view binds at most one tool.
4. In-component `isPending` skeleton branching → `useToolContext()` `pending` / `ready` / `error` branching inside the always-mounted default export.
5. `useCallTool` types come from exporting tool refs, not from generated `.mcp-use/generated/tool-registry.d.ts`; template `postinstall`/dev-loop typegen is gone. `callTool` resolves every non-error result (`CallToolSuccess`; `structuredContent` typed iff the tool declares an `outputSchema`); `ToolError` and transport/RPC/capability failures reject.
6. `useWidgetState` has no replacement hook — hold local UI state with React's `useState` (iframe lifetime only) and feed the model explicitly via `ModelContext`.
7. `useFiles` removed (ChatGPT-only capability).
8. `window.openai` is never consumed by the runtime; ChatGPT works through its native MCP Apps support.
9. Tool config `invoking`/`invoked`/`widgetAccessible` removed (openai overlay, no spec equivalent; `visibility` covers app/model narrowing).
10. Views work against the stateless 2026-07-28 wire; nothing view-related depends on sessions.
11. Asset routes move from `${basePath}/mcp-use/widgets/…` to `${basePath}/_mcp-use/public/…` only; build output from `.mcp-use/build/resources/widgets/<name>/` to one self-contained client build per view whose JS/CSS are inlined into the synthesized document (no shared chunks across views). Hosts obtain the view document only through `resources/read` — there is no HTTP document or bundle-asset route. Boot-time origin baking and the v1 `window.__getFile`/`__mcpServerUrl` globals are gone — origin resolves per request (forwarded headers, plus an override whose shape — `publicUrl` config vs v1's `MCP_URL` — is pending, see Open questions); `assetPrefix` has no v2 equivalent (a CDN fronts the public-asset route instead). One request-scoped `globalThis.__mcpUseViewConfig` (public asset base only) is injected into the synthesized document — not boot-time baked like v1's `__mcpPublicAssetsUrl`.
12. Registration no longer happens inside `listen()`/`getHandler()` (v1's async `mountWidgets` → `server.uiResource()`): the build primes the instance through a generated wrapper entry, and `resources/read` synthesizes the document from manifest data instead of re-reading built HTML from disk on every read. `server.uiResource()` has no v2 equivalent, and neither do v1's `exposeAsTool` / hand-built `uiResource` registrations — at most one tool binds a view via `view: { name }`, and an unbound view warns (decision 10).
13. Ambient hooks split by concern: `useHostContext()`, `useSendFollowUp()`, `useOpenExternal()`, `useDisplayMode()`, `useSendSizeChanged()` — split-by-concern is the design; each hook rerenders only on its channel (action hooks return stable runtime-owned callbacks). v1's aggregate `<McpUseProvider autoSize>` is replaced by `viewConfig.autoResize` plus direct composition of `ThemeProvider` / `ViewControls`.

## Open questions

- Stable `ui://views/<name>.html` vs content-hashed URIs: revisit only with evidence that a target host over-caches by URI (v1's `buildId` existed for ChatGPT; ChatGPT's MCP Apps path may not need it). External evidence: Skybridge appends `?v=<content-hash>` to view URIs in production — a second framework independently concluding hosts over-cache by URI. Expectation is this resolves toward a manifest-driven hash suffix once tested against ChatGPT; still deferred to that test, not decided here.
- `ui/download-file` (draft) exposure — as a standalone hook — once a target host ships it.
- Partial/streamed **tool results**: not in the 2026-07-28 protocol or the apps spec today (see Streaming). When a partial-result channel lands upstream, deliver it as ordinary `useToolContext` re-renders; until then, progressive UIs pull via `useCallTool`.
- **Vite dev `script-src` / eval:** Vite HMR and some dev transforms use `eval`, which strict host `script-src` policies may block. The MCP Apps CSP shape is origin-lists only — no `'unsafe-eval'` or nonce slot — so this cannot be declared in `view.csp`. If it bites in practice, the fix is Vite-side (jitless deps, no eval-based sourcemaps); dev already auto-appends the HMR websocket origin to `connectDomains` (Serving).
- Sampling from views (`createSamplingMessage`, draft) — post-alpha, follows the server package's sampling posture (`SPEC.md`, elicitation & context phase).
- Overlay mechanism shape (if a host demands `openai/*` keys): registration-boundary transform, opt-in per server or per host detection — design when needed.
