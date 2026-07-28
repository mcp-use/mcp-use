# mcp-use — Views (MCP Apps) spec

**Status:** Implemented alpha contract. Companion to `SPEC.md` (whose views phase points here) and `CLI_SPEC.md` (the implemented `dev`/`build`/`start` base contract this document extends).
**Scope:** the views runtime in the server package, view resources and protocol metadata, the React view runtime (`/react` subpath), the zero-codegen typing layer (`ToolRef` / `Register`), and the views half of the `dev`/`build`/`start` contract.
**Tracking:** Linear MCP-2601 (Views & MCP Apps + typing), MCP-2180 (widget→view naming).
**v1 reference:** `packages/mcp-use` (`src/react/`, `src/server/widgets/`) defines _what_ views must be able to do, never how. Parity with v1 is the alpha goal; the architecture is not carried over.

## Decisions at a glance

1. **MCP Apps is the baseline protocol, with narrow ChatGPT extensions.** The [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) (`io.modelcontextprotocol/ui`, spec revision `2026-01-26` + draft) is the standard wire format. The v1 adapter system and dual-protocol metadata are not ported. The runtime uses `window.openai` only when a capability has no equivalent host channel yet: files and persisted view state.
2. **Public naming is "view", everywhere.** `view` tool config, `useToolContext` hook, `ui://views/…`. "Widget" survives nowhere in the v2 API.
3. **`tool()` returns `ToolRef<Name, Input, Output>`** (not `this`). Typed `useCallTool` is pure type inference over exported refs — zero codegen, nothing generated on the dev/build hot path.
4. **Hook-first, latched view data.** The default export mounts when bootstrap starts the connection — before any tool result — and stays mounted for the iframe lifetime; the runtime never spreads props onto it. `useToolContext<Name>()` is the primary data API: a discriminated union over `pending` / `ready` / `error`. While pending, partial and complete inputs replace one `DeepPartial<Input>` `toolInput` snapshot. The first structured success or tool error is latched permanently; content-only successes are valid ambient activity and are ignored. Split hooks cover host context and actions; there is deliberately no aggregate hook.
5. **The React runtime builds on `@modelcontextprotocol/ext-apps`** (guest `App` class); the server package **inlines** the few wire constants and emits spec `_meta` itself — no ext-apps import server-side. Bootstrap creates a `McpAppRuntime` with exactly one eagerly configured App and one cached connection attempt; initialization failure is terminal for that mount. The runtime owns capabilities, snapshots, and deterministic disposal; the official ext-apps `App` owns MCP Apps protocol behavior; React hooks subscribe to narrow external-store channels via `ViewRuntimeContext`.
6. **Prefer raw `CallToolResult` for view-bound tools.** View-bound tool handlers return a plain `CallToolResult`: `{ content, structuredContent, _meta? }`. `structuredContent` is typed by the tool's `outputSchema` at the return position (existing `ToolResult<TOutput>` machinery). The deprecated `widget()` helper is a thin shim that shapes the same envelope — prefer writing the raw result.
7. **React runtime ships as `mcp-use/react`.** `react` and `react-dom` are optional peers owned by the application.
8. **View state has one cross-host API with host-specific durability.** `useViewState` exposes one JSON-serializable object per mounted view. ChatGPT persists and restores it through `window.openai.widgetState`; MCP Apps hosts receive it through `ui/update-model-context` and keep it for the iframe lifetime until the protocol exposes restoration.
9. **Views use external production assets by default, with opt-in inline delivery.** One Vite client build runs per view. The default build emits a hashed entry, optional split chunks, and CSS under `.mcp-use/build/views/<name>/assets/`; `resources/read` synthesizes HTML with absolute asset URLs. `mcp-use build --inline` instead emits one self-contained JS chunk plus aggregated CSS into the embedded registry, and `resources/read` places both directly in the HTML document. There is no `--no-inline`; omitting `--inline` preserves external delivery. Project-public files remain under `${basePath}/_mcp-use/public/…` in both modes. Hosts obtain the HTML document only through `resources/read`.
10. **One tool binds one view; every binder declares an `outputSchema`; the binder owns all resource facts.** A view has zero or one bound tool; a bound tool has exactly one view. A second tool declaring `view: { name }` for an already-bound view is a **hard error** at registration naming both tools. Every view-bound tool requires an `outputSchema` (hard error otherwise). The single binder owns all resource facts (`description`, `csp`, `permissions`, `domain`, `prefersBorder`). A `view:` naming a missing view directory is a **hard error** (broken `resourceUri`). A view directory no tool binds is a **warning only** (unused-code class: harmless dead weight, and erroring would break the scaffold-view-first authoring order and make feature-flagging a tool off a deploy-breaking action). App-only helper tools remain viewless (`visibility: "app"`, no `view:`) and are called from the view via `useCallTool`; use a separate view resource when another tool needs a rendered result.
11. **Views register from an embedded registry.** `mcp-use build` bakes the view registry into a generated wrapper entry that primes the server before anything mounts. `resources/list` and `resources/read` need no filesystem access. Default entries load JS/CSS from `.mcp-use/build/views/<name>/` through the production asset route or an `MCP_ASSETS_URL` CDN; `--inline` entries carry JS/CSS source in the registry and resource document. There is no runtime registry-file fallback; an unprimed `view:` is a loud mount-time error.
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
// views/product-search-result/view.tsx
import { useToolContext } from "mcp-use/react";

export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  return (
    <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />
  );
}
```

Note what makes this consistent: while pending, `query` arrives progressively via `toolInput` (fed by the tool's **input** schema — partials and the complete input share one last-write-wins field); after a successful result, `view.toolOutput` is exactly `structuredContent` (typed by `outputSchema`) — never a merge of the two channels. Tool errors land on the `"error"` branch. A content-only non-error result is valid ambient activity and leaves the context pending. The handler still echoes `query` into the output so the model sees it; the pre-result window no longer depends on that echo.

---

## Protocol posture

### Why no adapters

ChatGPT natively implements the MCP Apps bridge and metadata ([OpenAI: MCP Apps in ChatGPT](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)) — their guidance is "build with the standard by default; `window.openai` only for ChatGPT-specific extensions". Every host we target (ChatGPT, Claude, our inspector) speaks the standard, so the v1 dual-emission machinery buys nothing. Narrow runtime extensions are feature-detected directly instead of reintroducing a transport adapter.

`window.openai` is used for file upload/download through `useFiles()` and persisted view state through `useViewState()`. The state channel feature-detects `setWidgetState`, hydrates from `widgetState.modelContent`, and subscribes to `openai:set_globals`. Checkout, modals, file-library selection, and other vendor APIs remain direct, application-owned integrations.

### Spec target

We track the ext-apps **draft** spec (the SDK is beta; the draft adds `ui/download-file`, sampling, and the `message`/`updateModelContext` host-capability declarations) while emitting the stable `2026-01-26` protocol version constant, matching what the current ext-apps release itself does. Not everything in the spec is implemented for the alpha — the surface is driven by v1 parity (see the hook table), not spec completeness.

### Wire metadata

Emitted by this package (constants inlined; names are the spec's):

| Where                                                              | Key                | Value                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tool `_meta`                                                       | `ui.resourceUri`   | `ui://views/<view-name>.html`                                                                                                                                                                                                                                                    |
| tool `_meta`                                                       | `"ui/resourceUri"` | same value (legacy flat key, kept while hosts still read it)                                                                                                                                                                                                                     |
| tool `_meta`                                                       | `ui.visibility`    | `["model"]` / `["app"]` when the tool's top-level `visibility` is set — any tool, view-bound or not; **omitted entirely when unset** (host default: callable by the model, visible to the app). Declaration only — the server always lists every tool; hosts filter by this key. |
| tool result `_meta` (view-bound completed `tools/call`, non-error) | `ui.resourceUri`   | `ui://views/<view-name>.html`                                                                                                                                                                                                                                                    |
| tool result `_meta` (view-bound completed `tools/call`, non-error) | `"ui/resourceUri"` | same value (legacy flat key)                                                                                                                                                                                                                                                     |
| resource (`resources/list` entry)                                  | `description`      | from the bound tool's `view.description`                                                                                                                                                                                                                                         |
| resource (`resources/list` entry)                                  | `mimeType`         | `text/html;profile=mcp-app`                                                                                                                                                                                                                                                      |
| resource (`resources/list` entry) `_meta`                          | `ui.csp`           | `{ connectDomains, resourceDomains, … }` — author and CSP-environment domains, plus the server origin in `connectDomains` and the assets origin in `resourceDomains`; in dev, the server origin's websocket variant (`ws://`/`wss://`) is also appended to `connectDomains`      |
| resource (`resources/list` entry) `_meta`                          | `ui.permissions`   | from the bound tool's `view.permissions` when set                                                                                                                                                                                                                                |
| resource (`resources/list` entry) `_meta`                          | `ui.domain`        | from the bound tool's `view.domain` when set; otherwise the canonical MCP endpoint derived from the public server origin plus `basePath`                                                                                                                                          |
| resource (`resources/list` entry) `_meta`                          | `ui.prefersBorder` | from the bound tool's `view.prefersBorder` when set                                                                                                                                                                                                                              |
| resource content item (`resources/read` `contents[]`)              | `mimeType`         | `text/html;profile=mcp-app`                                                                                                                                                                                                                                                      |
| resource content item (`resources/read` `contents[]`)              | `text`             | synthesized HTML document (origin-resolved per request)                                                                                                                                                                                                                          |
| resource content item (`resources/read` `contents[]`) `_meta`      | `ui.csp`           | same shape as the list entry; **content-item value takes precedence** per MCP Apps spec and uses the current request to resolve server/assets origins and the dev HMR websocket origin                                                                                           |
| resource content item (`resources/read` `contents[]`) `_meta`      | `ui.permissions`   | same as list entry when set                                                                                                                                                                                                                                                      |
| resource content item (`resources/read` `contents[]`) `_meta`      | `ui.domain`        | same as the list entry; an explicit author value wins the canonical MCP endpoint default                                                                                                                                                                                         |
| resource content item (`resources/read` `contents[]`) `_meta`      | `ui.prefersBorder` | same as list entry when set                                                                                                                                                                                                                                                      |

Authors may also provide custom tool definition `_meta`. The registration boundary shallow-copies it and merges the framework-owned tool keys deterministically. The framework owns nested `ui.resourceUri`, nested `ui.visibility`, and legacy flat `"ui/resourceUri"`: a declared `view`/`visibility` supplies the canonical value and wins a collision; when the corresponding field is absent, a user-supplied value for that owned key is removed rather than advertising a contract the tool did not declare. Other top-level vendor keys and other fields of an object-valued `ui` entry are preserved. The merge never mutates the caller's object, never recursively assigns user keys into an existing target, and treats keys such as `__proto__` as data. This definition merge affects only `tools/list`; tool-result `_meta` retains the separate result-stamping rules below.

Security metadata (CSP, permissions, domain, prefersBorder) lives on the **resource**, never the tool — hosts ignore tool-level copies per spec. Authors declare external domains in the bound tool's `view.csp`; the framework appends the server origin to `connectDomains` and the assets origin to `resourceDomains`. The assets origin is `MCP_ASSETS_URL` when configured, otherwise the server origin. Spec-canonical hosts read `UIResourceMeta` from each `resources/read` content item's `_meta.ui` (the list entry is a static fallback; the content-item copy takes precedence). Both surfaces carry the same author facts; the read-time copy resolves origins from the current request.

Error results (`isError: true`) and intermediate `input_required` returns are **not** stamped with resource-URI metadata. An error must not create a new rendered view through legacy host behavior that keys off result `_meta.ui.resourceUri`, and an `input_required` return is not a completed tool result.

### Capability gating (stateless-first)

Per the `SPEC.md` stateless posture, UI support is a **request-scoped** fact: the 2026-07-28 wire carries `clientCapabilities` in per-request `_meta`, and MCP Apps support is `capabilities.extensions["io.modelcontextprotocol/ui"]` advertising `mimeTypes: ["text/html;profile=mcp-app"]`. Nothing is ever inferred from remembered sessions.

**The wire surface is unconditional.** `tools/list` always includes every registered tool regardless of client capabilities or top-level `visibility`. View-bound tools always carry `_meta.ui.resourceUri` (plus the legacy flat `"ui/resourceUri"` key) on `tools/list`, and every completed non-error result from that tool is stamped with the same link keys — regardless of whether the client advertises the UI extension. Intermediate `input_required` returns and error results are not stamped. View resources always carry `_meta.ui`, including framework-resolved server and assets origins, on both `resources/list` entries and each `resources/read` content item. When a tool's top-level `visibility` is set, `_meta.ui.visibility` is emitted as a declaration (`["model"]` or `["app"]`); filtering by that declaration is **client policy** — the server never omits tools from `tools/list`.

**Capability negotiation affects handler branching only.** `ctx.client.capabilities()`, `can(name)`, `extension(id)`, and `supportsViews()` all read one snapshot of the current request's `clientCapabilities`; `ctx.client.info()` reads that same request's `clientInfo`. `ctx.client.user()` separately normalizes OpenAI-specific ordinary request `_meta`; it is not an MCP capability or authenticated identity. These accessors never consult session state, return defensive copies for object-valued results, and use empty/absent fallbacks when their request metadata is missing. All values are client-declared hints, not authorization inputs. The convenience query `ctx.client.supportsViews()` lets handlers shape output differently for UI-capable vs text-only hosts:

```ts
export const searchFruits = server.tool(
  {
    name: "search-fruits",
    inputSchema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: { name: "product-search-result" },
  },
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

Note the branch is _optional_: a plain `CallToolResult` already degrades on text-only hosts (`content` is present; result `_meta.ui.*` is ignored). `ctx.client.supportsViews()` exists for when the two audiences deserve materially different output, not as a required ritual.

### ext-apps dependency posture

The package pins the official `client`, `core`, and `server` registry packages at the stable `2.0.0` release, which exposes the public `Protocol` base required by the Apps iframe channel. Until ext-apps PR #720 is released officially, `@modelcontextprotocol/ext-apps` resolves through the registry alias `@mcp-use/ext-apps@1.7.4-pr720.1`, built from that PR. This stack keeps `ui/initialize` as the only iframe handshake and accepts Standard Schema validators for App tools. Consequences:

- **Server side: keep our own thin registration layer.** Ext-apps' v2 server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`) are now compatible, but this framework already owns view binding, registry validation, per-request resource emission, and its `ToolRef` return type. The replacement remains intentionally small: inlined wire constants (mimetype, `_meta.ui.*` keys, extension ID), `_meta` emission at tool/resource registration, and a `getUiCapability` equivalent over per-request `extensions["io.modelcontextprotocol/ui"]`. Server-side types use **type-only imports** of canonical ext-apps types (`McpUiResourcePermissions`, `McpUiResourceCsp`) — zero runtime reach into ext-apps. Published declarations reference those types; tool-only projects without ext-apps installed see `UiPermissions` and `csp` degrade to `any` under `skipLibCheck` — acceptable because those fields only matter for view projects, which declare ext-apps.
- **View side: reuse essentially the whole guest protocol stack.** The React runtime wraps ext-apps' `App` + `PostMessageTransport`: Apps-only handshake, capability negotiation, the event system with one-shot replay, all outbound methods (`callServerTool`, `sendMessage`, `openLink`, `requestDisplayMode`, `updateModelContext`, `sendLog`, `downloadFile`, size-changed/auto-resize, teardown), the complete App-tools implementation (`registerTool` — see View tools), style helpers, and the `McpUi*` types. App tools pass their Standard Schema validators directly to ext-apps, which validates input and output and converts them to JSON Schema without a zod-specific compatibility bridge. Our `/react` code is product surface only — hooks, bootstrap, typing layer, presentation components — no protocol code.
- **Host side (inspector, test harness): reuse `AppBridge` with `client: null`** — its explicit escape hatch for hosts without an attached `Client`; request handlers (`oncalltool`, `onlistresources`, …) forward to the v2 client stack manually.
- **Dependency mechanics:** ext-apps is regular framework implementation machinery. The package pins the ext-apps PR #720 registry build and the official v2 SDK beta.5 packages as one coordinated set, so `npm install mcp-use` provides the complete view runtime without extra installation steps. Client and server are role-specific in ext-apps; the framework installs both because it publishes the MCP server and the browser-only `mcp-use/react` App runtime from one package. Lazy browser and command entry points keep tool-only imports from evaluating ext-apps or Vite. Replace the temporary alias with the corresponding official ext-apps release once PR #720 lands.

---

## Server API

### File-based views (the first-class authoring path)

View components live under `views/` (fixed convention, one directory per view, `view.tsx` as the component entry). The folder is named for the **product concept** (views); wire exposure remains MCP **resources** (`resources/list`, `resources/read`). There is deliberately no `viewsDir` knob in the alpha, matching `CLI_SPEC.md`'s no-config-file rule; a constructor field can be added later without breaking anything.

```
views/
  product-search-result/
    view.tsx        # default-exports the component; may also export viewConfig
    types.ts        # any other files in the directory are ordinary modules the view may import
```

A view file has two recognized exports: the **default export** — the component, mounted for the iframe lifetime and reading data through hooks (see Component lifecycle & view data) — and an optional immutable **`viewConfig`** export containing pre-render runtime configuration (`autoResize`, `displayModes`; see React runtime). Resource facts (description, CSP, permissions, domain, prefersBorder) live exclusively on the bound tool's server-side `view:` config (decision 10). Result types flow from that tool's `outputSchema` via `useToolContext<Name>()`.

Discovery registers one `ui://views/<dir-name>.html` resource per view; at most one tool may bind it (decision 10; an unbound view warns). The **primed view registry is the runtime source of truth** for what views exist and what assets they load. Production never rediscovers view directories or reads a registry file; the generated wrapper embeds that data as code. Nothing depends on `handler.toString()`.

Inline JSX returned from tool handlers is a documented **stretch** authoring model and is out of this contract; it must layer on the file-based path without changing it.

### Binding a tool to a view

The `view:` config on `server.tool()` binds the tool to a view resource. Resource wire facts (`description`, `csp`, `permissions`, `domain`, `prefersBorder`) are authored on that tool's `view:` — the single binder owns all facts (decision 10). Tool visibility is a separate top-level `ToolDefinition` field (`visibility?: "model" | "app"`), not part of `view:` (decision 13). The view file exports the component (and optional `viewConfig`); the framework reads the binder's `view:` fields at registration and emits them on the view's MCP resource (where hosts read them per spec — tool-level copies are ignored).

```ts
// tool-level (any tool — view-bound or not):
visibility?: "model" | "app";      // → _meta.ui.visibility on tools/list; omitted = host default (model + app)

view: {
  name: string;                    // view directory name, e.g. "product-search-result"
  description?: string;            // → resource description on resources/list and resources/read
  csp?: {                          // → resource _meta.ui.csp (framework appends server/assets origins)
    connectDomains?: string[];
    resourceDomains?: string[];
  };
  permissions?: UiPermissions;     // → resource _meta.ui.permissions
  domain?: string;                  // → resource _meta.ui.domain; default = MCP_URL origin + basePath
  prefersBorder?: boolean;         // → resource _meta.ui.prefersBorder
}
```

Authors declare every external domain the view loads in the binder's `view.csp.resourceDomains` and fetch targets in `connectDomains`. The framework always emits `csp`, appends the server origin to `connectDomains`, and appends the assets origin to `resourceDomains`. Hosts enforce CSP strictly — undeclared domains are blocked.

Binding rules (decision 10), enforced where the wire would lie — at registration in dev, at build in prod:

- `view.name` naming a missing view directory is a **hard error** (broken `resourceUri`).
- A `view:` tool without an `outputSchema` is a **hard error** — the output contract _is_ the `outputSchema` (`useToolContext<"search-fruits">()` reads it). A view that takes no result payload binds to a tool with an empty object schema (`outputSchema: z.object({})`).
- A view has zero or one bound tool; a bound tool has exactly one view. A second tool declaring `view: { name }` for an already-bound view is a **hard error** at registration naming both tools, e.g. `View "canvas" is already bound to tool "draw"; tool "refresh" cannot bind the same view. Each view may be bound to one tool.` Use a separate view resource when another tool needs a rendered result. App-only helper tools remain viewless and are called from the view via `useCallTool`.
- A view directory no tool binds is a **warning naming the view**, never an error — nothing on the wire is wrong (no host renders a view except through a tool result's `_meta.ui.resourceUri`), and erroring would punish the natural authoring order (view directory first, tool second) and turn feature-flagging a tool off into a build/deploy breaker. Unbound views are still built and registered — `resources/read` staying live is useful for inspector preview of not-yet-wired views.

The check itself is a set difference at mount time — the frozen tool registry against the primed view registry — re-run per dev reload.

The v1 `invoking`/`invoked` strings and `widgetAccessible` flag are `openai/*` overlay concepts with no spec equivalent — dropped from the alpha config (space reserved in a future overlay, not here).

### Returning results from view-bound tools

View-bound tool handlers return a plain `CallToolResult` — the same shape as every other tool (prefer raw; the deprecated `widget()` helper only builds this envelope):

```ts
return {
  content: [{ type: "text", text: "…" }],   // model/text-host narrative; also surfaced to the view
  structuredContent: { … },                  // model AND view; typed by outputSchema → toolOutput in the view
  _meta?: { … },                             // view ONLY; never enters model context
};
```

**Compile-checking against `outputSchema`.** The existing return-position contract applies: a tool with an `outputSchema` types its callback's return as `ToolResult<Output>`, which only accepts `CallToolResult & { structuredContent: Output }` (or an `isError` result). A `structuredContent` payload that doesn't match the tool's `outputSchema` fails at the handler's return position.

The handler and the view component are two ends of one call: `structuredContent` is forwarded to the bound view; `useToolContext<Name>()` surfaces the first structured result as `toolOutput` when `status === "ready"`. A valid MCP tool error (`isError: true`) lands on the `"error"` branch. A content-only non-error notification cannot be identified as the bound result and is ignored.

**Auto-stamping result `_meta`.** The framework auto-stamps `_meta.ui.resourceUri` (plus legacy flat `"ui/resourceUri"`) onto every completed non-error result of a view-bound tool so clients know an MCP App can render. Error results (`isError: true`) and intermediate `input_required` returns are not stamped. Handlers may pass additional keys on `_meta` for view-only data. On collision, wire keys win over handler keys; the reserved namespace is `ui.*` (`mcp-use/*` is reserved for framework use but carries no wire key on results).

### Channel visibility: what the model sees vs what the view sees

The full `CallToolResult` reaches the view (the host forwards it via `ui/notifications/tool-result`); what reaches the **model** is host policy, but the spec's design assumption — and ChatGPT's behavior — is: `content` and `structuredContent` are model-facing, `_meta` is not. Design for that split; never put secrets in any tool result channel (the view is still client-side).

| Data                          | Model                   | View                                                                            | Text-only host      | Carried as                                           |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| `structuredContent`           | ✅                      | ✅ (`useToolContext().toolOutput` when `ready`)                                 | host may render raw | `structuredContent`, typed by `outputSchema`         |
| `content`                     | ✅                      | ✅ (`useToolContext().content` when `ready` or `error`)                         | ✅ (the fallback)   | `content` blocks                                     |
| result `_meta` (handler keys) | ❌                      | ✅ (`useToolContext().meta` when `ready` or `error`)                            | ❌ (ignored)        | result `_meta`                                       |
| tool input                    | ✅ (it authored it)     | ✅ (`useToolContext().toolInput` — latest partial or complete pending snapshot) | ✅                  | `tools/call` arguments                               |
| view→model context            | ✅ (subsequent turns)   | source                                                                          | n/a                 | `ui/update-model-context` / `ModelContext`           |
| view-tool result              | ✅ (it called the tool) | source                                                                          | n/a                 | `tools/call` over the bridge → `useViewTool` handler |

Consequences worth spelling out in docs:

- **`structuredContent` is model-visible.** That is a feature — the model reasons over exactly what the user is looking at — but it prices structured output in tokens and rules it out for bulk payloads. The dividing question for every field: _should the model see this?_ Yes → `structuredContent`; no (bulk, presentation-only, e.g. base64 images, geometry, full result sets beyond what's discussed) → `_meta`.
- **`content` is the model/text-host narrative** ("Found 12 results, top match …"). Handlers should pass a short summary; since `structuredContent` is already model-visible, omitting `content` leaves text-only hosts with only the structured payload.
- **Result `_meta` is the view-only channel**: handler-supplied keys are preserved on result `_meta`, read via `useToolContext().meta` when `ready` or `error`, never typed by `outputSchema`, never model context. The framework also stamps the wire `ui.*` link keys (`ui.resourceUri`, `"ui/resourceUri"`) onto every completed non-error result from a view-bound tool; it leaves errors and intermediate `input_required` returns unstamped. The reserved namespace is `ui.*`; wire keys win on collision.
- The reverse direction is explicit, not ambient: nothing a user does _inside_ the view reaches the model unless sent via `useViewState` or `ModelContext` (model context push, no follow-up turn), `sendFollowUpMessage` (`ui/message`, triggers a turn), or returned from a view tool (_model-initiated_, see View tools).

### URI scheme and serving

- Resource URI: `ui://views/<name>.html` — stable across builds. (v1 embedded a `buildId` for ChatGPT's per-URI caching; that is an overlay concern. If host caching demonstrably requires it, a content-hash suffix can come from the embedded registry — deferred to implementation evidence, see Open questions.)
- The resource body is a complete HTML document rendered by hosts via `srcdoc` after `resources/read`. In **production**, the shell contains `<link rel="stylesheet">` and `<script type="module" src>` tags for hashed assets under `${basePath}/_mcp-use/views/<name>/…` or their build-time-rewritten CDN URLs; split chunks load via relative imports from the entry module URL. In **dev**, the same shell loads `/@vite/client` and the virtual view entry for HMR. The document is synthesized per request from the embedded registry entry and is never read from disk. Public-folder assets load from `${basePath}/_mcp-use/public/` or the configured assets CDN. Hosts obtain the document only through `resources/read`; there is no HTTP document route. The full contract — build pipeline, routes, origin derivation, caching — is "Build system & serving", below.

### Wire shape (reference — what our registration layer emits)

For the running example, `tools/list` carries:

```jsonc
{
  "name": "search-fruits",
  "inputSchema": {
    /* JSON Schema converted from `inputSchema` */
  },
  "outputSchema": {
    /* converted from `outputSchema` */
  },
  "_meta": {
    "ui": { "resourceUri": "ui://views/product-search-result.html" },
    "ui/resourceUri": "ui://views/product-search-result.html", // legacy flat key, kept while hosts read it
  },
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
        "connectDomains": [
          "https://fruit-store.fly.dev", // ← request-resolved server origin
        ],
        "resourceDomains": [
          "https://images.example.com", // ← author-declared in view.csp.resourceDomains
          "https://fruit-store.fly.dev", // ← request-resolved assets origin
        ],
      },
      "prefersBorder": true, // ← from view.prefersBorder when set
    },
  },
}
```

`resources/read` returns a `contents[]` item with the same `mimeType` and `_meta.ui` fields (content-item value takes precedence per MCP Apps spec) plus the synthesized HTML as `text`:

```jsonc
{
  "contents": [
    {
      "uri": "ui://views/product-search-result.html",
      "mimeType": "text/html;profile=mcp-app",
      "text": "<!doctype html>…", // ← origin-resolved per request
      "_meta": {
        "ui": {
          "csp": {
            "connectDomains": ["https://fruit-store.fly.dev"],
            "resourceDomains": [
              "https://images.example.com",
              "https://fruit-store.fly.dev", // ← per-request asset origin for view bundles and public assets
            ],
          },
          "prefersBorder": true,
        },
      },
    },
  ],
}
```

Resource `_meta.ui` carries author facts from the bound tool's `view:` config plus the framework-resolved server origin in `csp.connectDomains` and assets origin in `csp.resourceDomains`. `ui.domain` defaults to the canonical MCP endpoint (`MCP_URL` origin plus `basePath`) when the author omits it; other unset author facts (`permissions`, `prefersBorder`, …) are omitted. The list entry and each read content item emit the same facts; the read-time copy resolves origins per request so CSP and the default domain match the synthesized HTML. Clients without the UI extension still receive `ui.*` metadata on view resources, view-bound tools, and every tool on `tools/list` (including tools with top-level `visibility: "app"`, which carry `_meta.ui.visibility: ["app"]` for the host to filter).

---

## Build system & serving

Extends `CLI_SPEC.md`'s implemented workspace and command contract (its ground rules hold: `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk, no config file, fixed `.mcp-use/` layout). v1 reference: `packages/cli` `buildWidgets` + `packages/mcp-use/src/server/widgets/*` define what the pipeline must deliver — built assets, a manifest, HTTP serving for public assets, dev HMR — never how. The v1 mechanics (scratch `entry.tsx`/`index.html` files in `cache/`, boot-time origin baking, regex rewriting of built HTML, `window.__getFile` indirection, auto-injected Tailwind) are **not** carried over.

### One client build per view

`mcp-use build` adds a client environment alongside the node/SSR build. It runs **one Vite build per discovered view**. Each virtual entry (`virtual:mcp-use/views/<name>`) imports the `/react` iframe bootstrap and the complete view module, including its default component and optional `viewConfig`.

Each per-view build sets `cssCodeSplit: false` and uses a large `assetsInlineLimit` so imported assets become data URLs inside the bundle. In the default external mode, Vite code splitting remains enabled and the CLI records the **entry** chunk path and CSS paths in the embedded registry; additional JS chunks load through relative imports from the entry module. With `--inline`, Vite disables code splitting, returns the output without writing view bundle files, and the CLI records entry source plus aggregated CSS as `kind: "inline"`. `--source-maps` emits maps for external view bundles only; inline view maps remain disabled. No chunks are shared across views, so React and the runtime may be duplicated per view and inline resources can be large.

By default, the build records entry and CSS **paths**, not source, in the embedded view registry. The asset files are production artifacts, not scratch; deploy them with the server build or upload them to the static host selected by `MCP_ASSETS_URL`. With `--inline`, the registry records JS/CSS source and no per-view asset directory is emitted. In both modes, copied `public/` files remain deployment assets.

Output layout:

```
.mcp-use/build/
├─ index.js                       ← generated wrapper: embeds the views map, primes views, re-exports the server
├─ manifest.json                  ← start metadata plus mode-neutral views map for runtime adapters
└─ views/
   ├─ public/                     ← copied project `public/`
   └─ <name>/
      └─ assets/
         ├─ <name>-<hash>.js       ← entry and optional split chunks
         └─ <name>-<hash>.css     ← present when the view emits CSS
```

There are **no HTML files** in the build output. The view document is a pure function of the embedded registry entry: `resources/read` synthesizes a minimal shell with `<link>` tags for CSS, a `<script type="module" src>` for the entry JS, the request-scoped `__mcpUseViewConfig` script, and `<div id="root">`. Public-folder assets resolve per request. The client build uses Vite's relative `base: "./"` so split-chunk imports resolve from the entry module URL.

**Vite configuration:** `mcp-use` owns server compilation and all required view invariants. It always injects Tailwind, React, and views plugins, and every virtual view entry imports a virtual `@import "tailwindcss"` stylesheet. Utility classes therefore work with no author CSS import. Project `vite.config.*` files are loaded only for per-view client builds, where any additional user plugins and aliases are additive.

### Build metadata and embedded view registry

`.mcp-use/build/manifest.json` contains only the metadata that `mcp-use start` consumes:

```jsonc
{
  "buildId": "…",
  "entryPoint": "index.js",
  "createdAt": "…",
  "views": {},
}
```

The generated wrapper bakes the view registry into `.mcp-use/build/index.js`; `manifest.json` mirrors the same mode-neutral shape for runtime adapters. `start` relies on the wrapper and does not read the registry at runtime. Default production entries use `{ kind: "external", entry, css }`, where `entry` and `css` contain view-relative paths such as `assets/product-search-result-<hash>.js`. Split JS chunks are not listed; they load through relative imports from the entry module. When `MCP_ASSETS_URL` is set during the build, the recorded fields contain full CDN URLs instead. `mcp-use build --inline` emits `{ kind: "inline", js, css }` containing the bundled module and stylesheet source. Dev always primes the registry with external origin-absolute Vite paths and an additional `/@vite/client` script.

### Asset paths

Production uses two HTTP path spaces beneath the MCP mount:

- **View bundles:** `.mcp-use/build/views/<name>/<path>` maps to `GET ${basePath}/_mcp-use/views/<name>/<path>`.
- **Project-public files:** `.mcp-use/build/views/public/<path>` maps to `GET ${basePath}/_mcp-use/public/<path>`.

Hosts obtain the HTML document only through `resources/read`; there is no HTTP document route.

### Registration mechanism

How build/dev registry data becomes MCP registrations. The registry **freezes at first mount** (registration after `listen()` or the first `server.fetch` request throws — registrations are replayed per request, late ones would be silently inconsistent). View registration must therefore be complete by the time the entry module finishes evaluating; it cannot await a filesystem read on the first request. v1's trigger — `mountWidgets()` doing async `fs` work inside the serving path, then calling `server.uiResource()` — is structurally impossible here and is not wanted back.

**Instance registry, primed via an internal API.** `MCPServer` grows a views registry alongside `#tools`/`#resources`, populated through one symbol-keyed method:

```ts
// exported from the package root, tagged @internal (non-public by convention;
// physically reachable so generated code and the CLI can use it)
export const registerViews: unique symbol;

// on MCPServer:
[registerViews](views: ViewsManifest, options?: { dev?: boolean }): void;   // throws if already primed, or after first mount

type ViewManifestEntry =
  | { kind: "inline"; js: string; css: string }   // `build --inline` or internal callers
  | { kind: "external"; entry: string; css: string[]; scripts?: string[] }; // production paths or dev Vite URLs

interface ViewsManifest {
  [viewName: string]: ViewManifestEntry;
}
```

The same package's CLI (`src/cli/`) imports the symbol directly; the generated wrapper entry imports it from the package root. View resources are _not_ sugar over the public `resource()`: their `_meta.ui.*` emission and body are origin-resolved per request, so the per-request SDK-server build does the emission itself — register each view's resource, append server/assets origins to CSP, synthesize the document from the registry entry on read, and stamp `_meta.ui.resourceUri` onto the bound tool. The tool-side URI needs no registry data (it is deterministic from `view.name`); the primed registry validates the binding and supplies the asset entry. Priming is an instance method, not a module global, so several servers compose in one process and dev can prime each fresh instance independently.

**Delivery: the registry travels as code.** `mcp-use build` builds the server bundle from a generated wrapper entry. The wrapper embeds the view registry, primes the user's `MCPServer`, and re-exports it. The user entry must default-export the `MCPServer` instance — the same entry contract `CLI_SPEC.md` already enforces for `dev` and `start`:

```ts
// .mcp-use/build/index.js (conceptually; generated, never user-visible)
import server from "<bundled user entry>";
import { registerViews } from "mcp-use";
server[registerViews]({
  "product-search-result": {
    kind: "external",
    entry: "assets/product-search-result-<hash>.js",
    css: ["assets/product-search-result-<hash>.css"],
  },
});
export default server;
```

Because priming happens during module evaluation of the built entry, it is complete before any downstream `server.fetch`/`listen()` call. The registry itself is part of the JS module graph; the referenced asset files remain separate deployment artifacts. Per mode:

- **`start`:** imports the built entry; views are primed by the wrapper before `listen()`. Nothing new in the `start` contract.
- **Serverless:** the function entry imports `.mcp-use/build/index.js`, not the TypeScript source. The MCP list/read/tool-metadata paths use the embedded registry with no filesystem access, while rendered views still require the built view assets through traced filesystem files, platform static assets, or `MCP_ASSETS_URL`.
- **Dev:** no wrapper — the CLI calls the same internal API on each freshly loaded instance before wiring it into the swappable handler, feeding it the in-memory registry (`kind: "external"`) and `{ dev: true }` so HMR websocket origins are emitted in resource CSP. View add/remove triggers the existing reload-and-swap; view-code edits stay on Vite HMR. Dev entry and script paths are origin-absolute `/`-prefixed Vite module paths.

**No registry fallback, loud errors.** The runtime never reads `manifest.json` or reconstructs view registrations from the filesystem. A tool declaring `view: { name }` on an instance with no primed views — or a name the primed registry does not contain — is a mount-time error naming the view and the fix (`run mcp-use build` / deploy the built entry). Asset-file requests are separate from registry priming and return `404` when the deployed file is absent.

**Consequence, documented:** views make `mcp-use build` mandatory for deployment. The ships-unbuilt serverless shape (function entry importing the TS source directly, per the current `examples/vercel`) remains valid for tool-only servers; the views variant of the example imports the built entry.

### Serving

All framework HTTP surface lives under **`${basePath}/_mcp-use/`** — a framework-owned namespace inside the one mount point users already expose. The existing handler covers the MCP endpoint, production view bundles, and public assets without a second application mount.

Hosts obtain the view document **only** through `resources/read`. The MCP Apps spec defines no host flow that navigates an iframe to a server document URL; the inspector reads the resource and renders it through `srcdoc`. Unbound views are previewed the same way. The document then loads its production JS/CSS from the view-assets route or a configured CDN.

| Route                                                | Serves                                                                                                      | Cache-Control                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `GET/HEAD ${basePath}/_mcp-use/views/<name>/<path…>` | production entry, split chunks, and CSS under `.mcp-use/build/views/<name>/` for a registered external view | `public, max-age=0, must-revalidate` |
| `GET/HEAD ${basePath}/_mcp-use/public/<path…>`       | project-public files from `public/` in dev or `.mcp-use/build/views/public/` in production                  | `public, max-age=0, must-revalidate` |

By default, both static routes include `Access-Control-Allow-Origin: *`; an explicit global CORS configuration owns that header instead. Hosts render views in sandboxed cross-origin iframes (`srcdoc`), so module scripts and other fetches need CORS. Dev Vite module URLs use the gated CORS behavior in `CLI_SPEC.md`: a tunnel emits `*`, while localhost reflects a validated loopback `Origin` and adds `Vary: Origin`.

**Document synthesis** for `resources/read` branches on the registry entry kind:

- **`external` (production):** resolve view-relative `assets/…` paths beneath `${basePath}/_mcp-use/views/<name>/`, or preserve full CDN URLs written at build time. Emit `<link>` and `<script type="module" src>` tags.
- **`external` (dev):** resolve origin-absolute Vite paths, including `/@vite/client` and the virtual view entry, against the request-derived assets base. Emit the same external tags.
- **`inline` (production opt-in):** emit `<style>` and inline `<script type="module">` tags with HTML-end-tag escaping. `mcp-use build --inline` emits this entry kind.

Every branch includes `__mcpUseViewConfig`, whose `publicBase` is resolved per request, and a `<div id="root" data-mcp-use-loading>`. A framework-owned, CSS-only `Compiling...` indicator is centered while the entry module loads. The bootstrap removes `data-mcp-use-loading` immediately before calling `root.render`, so the indicator cannot overlap the app and requires no additional asset request. Production split chunks are loaded by relative imports from the entry module and require no additional document tags.

**Origin resolution is request-scoped** — applied at `resources/read` emission time:

- **`MCP_URL`** — server public origin (`.origin` only): combined with `basePath` for the canonical MCP endpoint and default `ui.domain`; its origin is also used for CSP `connectDomains` and the dev HMR websocket host.
- **`MCP_ASSETS_URL`** — assets URL prefix (origin + optional path): view JS/CSS hrefs and `__mcpUseViewConfig.publicBase`. Falls back to `MCP_URL` origin, then `Forwarded` / request origin.
- **CSP env** — `CSP_URLS` (shortcut for all four MCP Apps categories) and `CSP_*_DOMAINS` per-category overrides merge with author `view.csp` before MCP auto-append. Env vars rank above MCP auto-append.

At build time, a valid `MCP_ASSETS_URL` rewrites production view `entry`, `css`, and `scripts` paths to full URLs using the server entry's `basePath`. The rewritten registry is embedded in `index.js`; the CLI does not upload files.

To deploy those URLs, upload the contents of `.mcp-use/build/views/` and configure the static host so:

- `${MCP_ASSETS_URL}${basePath}/_mcp-use/views/<name>/<path>` serves `.mcp-use/build/views/<name>/<path>`.
- `${MCP_ASSETS_URL}${basePath}/_mcp-use/public/<path>` serves `.mcp-use/build/views/public/<path>`.

Keep `MCP_ASSETS_URL` set at runtime when `publicBase` should also point at that static host. The full production view bundle URLs remain embedded even if the runtime variable is absent.

**srcdoc iframes have no document base URL.** Every production bundle URL, public asset URL, and dev Vite URL must therefore be absolute; a root-relative path would resolve against the host page. `resources/read` resolves production view-relative paths and `publicBase` against `MCP_ASSETS_URL`, then `MCP_URL`, then forwarded/request origin. Dev sets Vite `server.origin` to the browsable dev origin so imported asset URLs are absolute.

**CSP consequence:** hosts enforce the `resources/read` content item's `_meta.ui.csp`; the list entry is a static fallback. The registration layer appends the assets origin to `resourceDomains`: the explicit `MCP_ASSETS_URL` origin when configured, otherwise the server origin. That covers production JS/CSS and public assets without an author declaration. It appends the server origin to `connectDomains`; in dev it also appends the matching websocket origin (`http:` → `ws:`, `https:` → `wss:`) so Vite HMR passes `connect-src`. Author and CSP environment domains remain ahead of these framework additions.

### Public assets

v1 parity: authors drop static files in a project-root `public/` directory and reference them from views with root-relative paths (`/fruits/apple.png`). Two mechanisms coexist:

1. **Imported assets** — `import url from "./file.png"` in a view module. Vite inlines assets below the framework's large `assetsInlineLimit` as data URLs in the emitted JS/CSS; in dev they resolve through Vite with absolute URLs via `server.origin`.
2. **Public folder** — files under `public/` served at `GET ${basePath}/_mcp-use/public/<path…>`. **Build** copies `public/` → `.mcp-use/build/views/public/`, including tool-only builds because server icons use the same route. **Dev** and **start** read from `<projectRoot>/public` (dev) or `.mcp-use/build/views/public/` (production). Missing `public/` → route 404s; nothing breaks. Percent-decoding happens before containment checks; malformed encodings, path traversal (`..`), backslashes, directories, and missing files return `404`. `HEAD` returns the same status and headers as `GET` with no body.

**Runtime resolution.** The synthesized document injects one inline `<script>` before the view module script:

```html
<script>
  globalThis.__mcpUseViewConfig = {
    publicBase: "<origin><basePath>/_mcp-use/public/",
  };
</script>
```

`publicBase` is request-scoped (computed per request), not boot-time baked — the v1 mistake of baking origin at startup remains dead. `<Image>` reads this global (the one public consumer; the internal `publicAsset()` resolver is not exported — v1 shipped the same posture, an `<Image>` component over injected globals with no standalone resolver): root-relative `src` values resolve to `${publicBase}<path-without-leading-slash>`; absolute `http(s):` and `data:` URLs pass through; fully-relative paths (no leading `/`) are left alone. Non-`<img>` consumers (CSS backgrounds, `<video>`) can be served by exporting the resolver later — additive, deferred until asked for. `import.meta.url` relative resolution was rejected for public assets because the dev virtual entry URL (`/@id/__x00__virtual:mcp-use/views/<name>`) has no stable sibling `public/` segment — the injected config works identically in dev and production.

### Dev

`mcp-use dev` adds the client environment to the **same Vite dev server** the implemented CLI already runs (`CLI_SPEC.md`'s single process — today it runs the node/SSR environment only, with the Vite server in middleware mode), with its middleware mounted at `${basePath}/_mcp-use/` ahead of the MCP handler. When views exist, Vite `server.origin` is set to the dev server's browsable origin — `http://localhost:<port>` for loopback/wildcard binds, `http://<host>:<port>` otherwise (a wildcard bind address like `0.0.0.0` accepts connections but is not itself a valid request host in every browser) — so imported asset URLs are absolute (srcdoc iframes, Public assets).

- View documents are synthesized per `resources/read` with `/@vite/client` and the virtual entry served through Vite middleware (`kind: "external"`). Assets flow through Vite transform, with no build step or manifest file. The in-memory view registry stays current through Vite's watcher: adding or removing a view directory triggers the existing reload-and-swap path and primes a fresh `MCPServer`; view-code edits use client HMR. The next `tools/list`/`resources/list` reflects directory changes, and subscribed modern clients are prompted to refetch. The `public/` route serves `<projectRoot>/public` directly.
- **View-file edits get Vite HMR.** This is the client half of the one dev server: view code is pure browser code, so Vite's own HMR channel applies to it. The server entry keeps `CLI_SPEC.md`'s implemented reload-and-swap contract untouched — its reload-not-HMR rule is about the _server_ module graph, and views don't change that. Because hosts enforce the resource's `ui.csp.connectDomains` against the HMR websocket, dev priming (`__primeViews(views, { dev: true })`) appends the request-resolved server origin's websocket variant to `connectDomains` on both `resources/list` and each `resources/read` content item. Production never emits that websocket origin.
- **HMR means React Fast Refresh, not document reload.** A bare Vite setup has no HMR accept boundary in a view's module graph, so every `view.tsx` edit degrades to `full-reload` — which reloads the srcdoc iframe document and wipes all component state, bridge state, and pending tool results. Three pieces prevent that, all dev-only:
  - **`@vitejs/plugin-react` provides the refresh boundary.** It is a regular framework dependency and is injected exactly once by `mcp-use dev`.
  - **The virtual entry imports the refresh preamble.** Fast Refresh needs its runtime hooked into the window before any component module evaluates — the job plugin-react's `transformIndexHtml` does for Vite-served HTML, which the synthesized srcdoc document never passes through. When refresh is active, each virtual entry's **first** import is the plugin's own virtual preamble module (`@vitejs/plugin-react/preamble`), so the hook is installed before react-dom or any refresh-wrapped view module runs.
  - **The virtual entry self-accepts.** Dev entries end with `import.meta.hot.accept()`, so an update that propagates past the view module (e.g. a non-component export defeating Fast Refresh's self-accept) re-runs the bootstrap — `bootstrapView` reuses the mounted runtime and React root for the same root element (HMR), warns if normalized `viewConfig` changed (full iframe reload required for config changes), and throws if a second root is targeted while one is mounted — instead of escalating to a document reload. Build entries carry neither the preamble import nor the accept call (production output stays inert).
- **Server-entry list invalidation:** after a successful handler swap, dev publishes all three list-change events on the process-scoped SDK bus shared by every handler generation. This is deliberately not a registry diff: modern subscribers refetch authoritative lists from the new stateless handler, while failed reloads publish nothing. Pure view-code edits remain on Vite HMR and do not invalidate server lists; adding or removing a view triggers the server reload path above.
- `view.name` → directory validation (Server API, above) runs at registration in dev and at build in prod — same check, two enforcement points.

### `start` and serverless

`mcp-use start` imports the built wrapper entry, which primes views with external asset paths by default or embedded source after `build --inline`. It serves `.mcp-use/build/views/<name>/` when external bundles exist and `.mcp-use/build/views/public/` in both modes; Vite and view discovery are absent from the start path. Serverless targets use the same built entry and `server.fetch` routes.

In external mode, production view bundles and project-public files are filesystem-backed unless their URLs point to a static host. Inline mode removes the view-bundle filesystem dependency, but project-public files remain external assets. Node `start` reads required files from `.mcp-use/build/views/`. Vercel-style functions must trace that directory when it contains required external or public assets. Cloudflare Workers must expose equivalent Workers Static Assets or bundled VFS files. With `MCP_ASSETS_URL`, a CDN or static host can serve the required URL mappings instead; the server still needs the embedded registry in `index.js`.

---

## Typing: `ToolRef` + `Register` (zero codegen)

Exports-based inference is the primary mode; tool typegen is an explicit escape hatch only, never on the dev/build hot path. `dev`, `build`, and `typecheck` only reconcile the constant root `mcp-env.d.ts` shim; they do not inspect tools or generate a registry. The full option space behind this choice (including the rejected alternatives) is preserved in `type_proposals.md`.

### `tool()` return-type change

`tool()` returns `ToolRef<Name, Input, Output>` instead of `this` — a value (`{ name }` at runtime) carrying phantom types read off the existing `InferToolInput`/`InferToolOutput` machinery in `src/tools.ts`. Standard Schema does the inference, so typed views work with zod v4, ArkType, and Valibot alike. Requires a `const` type parameter (`tool<const T extends ToolDefinition>`) so `name` infers as a literal.

This ends `server.tool(…).tool(…)` chaining — an acceptable break: nothing in the repo chains today, chaining without type accumulation is convenience only, type accumulation remains off the table (`SPEC.md` ground rule — `MCPServer` stays non-generic; `resource()`/`prompt()` keep returning `this` until a consumer needs refs), and the official v2 SDK itself returns a handle from `registerTool`.

### How types reach view files

View bundles must never contain server code, so the ref **value** is never imported by a view. The type crosses in type space only:

```ts
// mcp-env.d.ts — scaffolded at the project root; mcp-use refreshes the entry
// (the vite-env.d.ts pattern: configuration, not codegen — it lives in the
// source tree because .mcp-use/ is gitignored and rm -rf-safe, CLI_SPEC.md)
import "mcp-use/vite-client";

declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}
```

```ts
// in /react
export interface Register {} // filled (or not) by the project's mcp-env.d.ts

type RegisteredToolsModule = Register extends { tools: infer M }
  ? M
  : undefined;

type ToolsFromModule<M> = {
  [K in keyof M as M[K] extends ToolRef<infer N, any, any>
    ? N
    : never]: M[K] extends ToolRef<any, infer I, infer O>
    ? { input: I; output: O }
    : never;
};

type RegisteredTools = RegisteredToolsModule extends undefined
  ? Record<string, { input: Record<string, unknown>; output: unknown }>
  : ToolsFromModule<RegisteredToolsModule>;
```

Users export every statically declared tool ref (`export const searchFruits = server.tool(…)`) — the module is the registry; no map API, no `export type AppType` ritual, no user-written `declare module`. The name union covers **every exported ref** regardless of `visibility` (a view may call model-visible tools too; `visibility: "app"` declares app-only visibility — the host hides the tool from the model per `_meta.ui.visibility`, not the server). `typeof import()` is a live tsserver edge: add a tool, and every view's `useCallTool` union updates with no process running. Multi-file registration composes via re-exports (`export * from "./tools/fruits.js"`).

Once `mcp-env.d.ts` registers the server entry, `useCallTool("name")` accepts only those exported refs. Forgetting `export const` is therefore a TypeScript error at the call site whose expected string tells the author to export the `ToolRef`. Tools registered from loops, runtime configuration, OpenAPI documents, or other dynamic sources use the explicitly typed `useDynamicTool<Args, Result>("name")` escape hatch instead.

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

Keying by tool name (not view directory name) is deliberate: view names exist only in the discovered filesystem and embedded registry, which type space cannot see without codegen — tool names exist as literal types on exported refs. The type parameter is the author's declaration of which tool delivers results to this view. It is not enforced in type space (a wrong literal compiles against the wrong schema); the runtime binding checks at mount/build (decision 10) are the enforcement. Unbound views (inspector-preview only) never reach `"ready"` — components branch on hook state and declare no required result payload.

**Note for cutover:** the `declare module` specifier must match the published import path — it becomes `"mcp-use/react"` when the package renames. The scaffolded file is the only thing that changes.

### Fallback ladder

1. `useCallTool("name")` — primary; typed via `Register` when the project has `mcp-env.d.ts` and the ref is exported.
2. `useCallTool(toolRef)` — for contexts where the ref value is legitimately in scope (the inline-JSX stretch path); not for file-based views (value import = server code in the bundle).
3. `useDynamicTool<Args, Result>("name")` — explicit generics for dynamically registered tools that are statically untypeable in any framework.
4. Empty `Register` (no `mcp-env.d.ts`) degrades to `(name: string)` — non-scaffolded projects compile untouched until `dev`, `build`, or `typecheck` creates the shim.

### Typegen, demoted

No command generates tool-specific types during `dev`, `build`, `typecheck`, or `start` — v1's run-the-server generator (`tool-registry-generator.ts`, `zod-to-ts.ts`) is not ported. `dev`, `build`, and `typecheck` perform one constant-file reconciliation: if root `mcp-env.d.ts` is absent, they create it with the framework-owned Vite client types and a type-only import of the discovered server entry; if it carries a current or legacy mcp-use generated header, they refresh it; otherwise they treat it as user-owned and never overwrite it. The Vite types cover client asset imports, `import.meta.env`, and HMR without requiring generated projects to declare Vite as a direct dependency. `mcp-use typecheck` then runs the project's own `tsc --noEmit`, combining that reconciliation and compiler pass into the agent/CI workflow. A future `mcp-use typegen` remains an explicit secondary mode for consumers with no compile-time path to server source; if built, it is a TS-checker-based static extractor (reads resolved `ToolRef` types; never executes user code), defaulting output to `.mcp-use/generated/`. Not an alpha deliverable.

All v2 `create-mcp-use-app` templates scaffold the root `mcp-env.d.ts`; the MCP Apps template is the reference for the exported-refs pattern.

---

## React runtime (`/react` subpath)

`mcp-use/react` is browser-only code built on the ext-apps guest `App` (one instance per iframe document, connected once via `PostMessageTransport`); `react` and `react-dom` are optional peers; importing the subpath from server code is unsupported. The v1 hook _surface_ is kept (renamed); the v1 transport guts (three-provider selection, `window.openai` branch, hand-rolled `McpAppsBridge`) are not.

### Runtime architecture

Ownership splits three ways:

- **`McpAppRuntime`** — one eagerly created ext-apps `App`, one cached `connect()` promise, capabilities, snapshots (tool / host / theme / display / files channels), stable actions, and deterministic disposal. Initialization failure is exposed through host runtime state and is terminal for the mount: later `connect()` calls return the same rejected promise, never create a new App, and never reconnect. Each runtime owns one `ModelContextStore`.
- **ext-apps `App`** — MCP Apps protocol behavior (handshake, events, outbound methods, tool registry).
- **React hooks** — subscribe to narrow external-store channels via `ViewRuntimeContext` (no default singleton). Hooks used outside a bootstrap-mounted view throw: `mcp-use/react hooks require a browser view mounted by bootstrapView`.

**Bootstrap** (`bootstrapView(viewModule)`):

1. Validate the browser environment.
2. Read and normalize `viewModule.viewConfig` (reject invalid, empty, duplicated, or non-inline-containing `displayModes`).
3. Create the runtime and App (with normalized `autoResize` / `availableDisplayModes`); install temporary empty tool handlers (see View tools).
4. Start `runtime.connect()` (attach a rejection handler immediately).
5. Create the React root and render under a top-level error boundary + `ViewRuntimeProvider`.

React mounts immediately after connection starts — the component renders in pending state during the handshake. One App per iframe document: a second root throws; repeated bootstrap for the same root reuses the mounted runtime and App (HMR) without another connection attempt and warns if normalized config changed (full iframe reload required for config changes). A failed initialization does not automatically retry; a fresh mount requires disposal/rebootstrap (normally a full iframe reload). Disposal unmounts React before closing the App (so hook cleanup can remove view tools while the connection still exists) and clears the mount record, permitting fresh rebootstrap.

Capability checks are centralized in the runtime: `callServerTool` requires host `serverTools`; `sendFollowUp` requires message support; `openExternal` requires `openLinks`; `requestDisplayMode` rejects modes outside the negotiated intersection of normalized `viewConfig.displayModes` and `hostContext.availableDisplayModes` (host omits modes → only `"inline"`). `useFiles` requires both ChatGPT file helpers and rejects each action with a descriptive error when unavailable. Size notifications have no capability guard (the MCP Apps draft defines none).

Individual action hooks return stable runtime-owned methods — there is no aggregate `useViewActions`.

`useFiles()` is the sole vendor-extension exception. It keeps the familiar v1 shape `{ isSupported, upload, getDownloadUrl }`, but deliberately omits v1's `modelVisible` option and widget-state side effect. `ui/update-model-context` can make content or structured data visible to the model, but sending an opaque `fileId` there does not attach or authorize the uploaded file, so the hook does not imply otherwise. The files channel is isolated from MCP Apps host/tool updates and does not subscribe to `openai:set_globals`.

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

**1. Tool _arguments_ stream — supported** (spec: `ui/notifications/tool-input-partial`). Hosts deliver progressively parsed arguments while the model is still generating the call — the pre-result window. Partials fire 0..n times strictly before the single complete `ui/notifications/tool-input`. The always-mounted component reads this through `useToolContext<Name>()` — both partial and complete args write the same `toolInput` field (last write wins):

```tsx
export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();

  if (view.status === "error") {
    return <ErrorBanner message={view.error.message} />;
  }

  if (view.status === "pending") {
    return <SearchSkeleton query={view.toolInput?.query} />;
  }

  return (
    <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />
  );
}
```

While pending, `toolInput` is `DeepPartial<Input>` because either notification may expose provisional JSON. Each partial or complete notification replaces the previous snapshot. The deliberate type-source split remains: `toolInput` types from the tool's `inputSchema`; `toolOutput` from its `outputSchema`.

**"Streaming tool output" (the generative-UI recipe).** When the thing to render _is_ what the model is writing (a drawing, generated UI code, long-form content — the Excalidraw MCP app pattern), put that payload in the tool's **input** schema and render it progressively via `toolInput` inside the single always-mounted component. The final `"ready"` state shows the same visual surface with complete, honestly-typed data from `toolOutput` — no echo-input-into-output workaround is needed for the pre-result window:

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
// views/canvas/view.tsx — one component, one mount, progressive then complete
export default function Draw() {
  const view = useToolContext<"draw">();
  const elements =
    view.status === "ready"
      ? view.toolOutput.elements
      : (view.toolInput?.elements ?? []);
  return <Canvas elements={elements} streaming={view.status === "pending"} />;
}
```

Schema guidance that falls out: **declare streamable payloads as structured schema, not JSON-in-a-string.** Hosts heal the _outer_ argument JSON, so a `z.array(...)` field arrives as a partial array of typed elements; a stringified payload arrives truncated mid-token and the view must re-heal it by hand (the shipped Excalidraw app pays exactly that cost). Because the component never unmounts across pending → ready, DOM and React state built during progressive input survive the transition.

**2. Tool _results_ do not stream — wire fact, honest alpha posture.** The protocol delivers one `ui/notifications/tool-result` per call. `useCallTool` owns its direct RPC response; the host may also forward that lifecycle result to the displayed View. Content-only ambient results are ignored, and the terminal initial-result latch prevents later structured results from becoming new `toolOutput`.

### View tools (`useViewTool`)

The apps spec lets the _view_ expose tools the **host/model** calls while the view is displayed (ext-apps `App.registerTool` → `RegisteredAppTool`, WebMCP-style; Linear MCP-2309). This is the third tool flavor — keep the taxonomy straight:

| Flavor                   | Registered by                           | Called by                   | Lifetime                                                            |
| ------------------------ | --------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| server tool              | `server.tool()`                         | model (via host)            | server process                                                      |
| server tool, app-visible | `server.tool({ visibility: "app", … })` | the view, via `useCallTool` | server process; host hides from the model per `_meta.ui.visibility` |
| **view tool**            | `useViewTool` inside the component      | host/model over the bridge  | while the component is mounted                                      |

View tools are ephemeral, conversational UI affordances whose handlers close over live React state ("highlight-fruit", "pan-map"). The hook mirrors `server.tool(definition, callback)` — same config keys (`name`, `title`, `description`, `inputSchema`, `outputSchema`, `annotations`, plus `enabled`; `schema` aliases `inputSchema`), handler args inferred via Standard Schema, return typed by the same `ToolResult<Output>` conditional as server tools (raw `CallToolResult`):

```tsx
const [selected, setSelected] = useState<string | null>(null);

useViewTool(
  {
    name: "highlight-fruit",
    description: "Highlight a visible result",
    inputSchema: z.object({ id: z.string() }),
  },
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
- **Channel note:** a view tool's result (`content`/`structuredContent`) flows host→model — the third explicit view→model channel (alongside `updateModelContext` and `ui/message`), distinguished by being _model-initiated_.

### `/react` API reference

The complete alpha surface. Everything here is exported from `mcp-use/react`; types marked _vendored_ alias the ext-apps `spec.types.ts` definitions (carried with attribution, per the dependency posture).

**Types.**

```ts
/** Augmented by the project's mcp-env.d.ts; empty by default. */
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
type CallToolSuccess<Result> = CallToolResult & { isError?: false } & ([
    Result,
  ] extends [never]
    ? unknown
    : { structuredContent: Result });
```

**`useToolContext<Name>()`** — primary data hook. Returns the latched `pending | ready | error` `ToolContextHandle<Name>` (Component lifecycle & view data). Narrow on `status === "ready"` for typed `toolOutput`; `"error"` contains `ToolError`.

```ts
function useToolContext<
  Name extends keyof RegisteredTools,
>(): ToolContextHandle<Name>;
```

**Helpers**

```ts
/** Concatenated text content of a tool result, or undefined when it has none. */
function toolResultText(
  result: Pick<CallToolResult, "content">
): string | undefined;
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
  hostInfo: HostInfo | undefined; // getHostVersion()
  hostCapabilities: HostCapabilities | undefined; // getHostCapabilities()
  hostContext: HostContext | undefined; // the raw object (vendored type)
  isAvailable: boolean; // bridge connected
};

function useViewTheme(): "light" | "dark"; // narrow theme-only subscription
```

**Action hooks** — one hook per concern; stable function identities owned by the runtime.

```ts
function useCallTool<Name extends keyof RegisteredTools>(name: Name):
  CallToolHandle<RegisteredTools[Name]["input"], RegisteredTools[Name]["output"]>;
function useCallTool<R extends ToolRef<string, unknown, unknown>>(ref: R): /* same, from the ref */;
function useDynamicTool<Args extends Record<string, unknown>, Result = unknown>(name: string):
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

**`useViewState<T extends Record<string, unknown>>(defaultState)`** — one shared JSON-serializable state object per mounted view runtime. Every component in the view subscribes to the same canonical object and receives a synchronous `useState`-style setter. The first initialized default wins; ChatGPT-restored state takes precedence. State updates are optimistic and model-visible. ChatGPT persists and restores `modelContent` through `window.openai.setWidgetState` plus `openai:set_globals`; MCP Apps sends the same object through `ui/update-model-context` without local-storage persistence, so state lasts for the current iframe lifetime. The reserved `_uiContext` key is rejected in developer state and filtered from hook snapshots.

**`<ModelContext content={string}>{children?}</ModelContext>`** and **`modelContext.set/remove/clear`** — the natural-language half of the shared view→model document. Each runtime owns one `ModelContextStore`, which also owns `useViewState`. Components register text in a parent-child tree; nested components serialize as an indented markdown list. Empty parents re-parent descendants to the nearest registered ancestor. Imperative entries join as roots under stable keys. The serialized tree is always merged under `_uiContext`, including `_uiContext: ""` when empty. Each delivery carries the complete `{ ...viewState, _uiContext }` snapshot. MCP Apps receives the object as `structuredContent` and its JSON serialization as one text `content` block; ChatGPT receives the object as `widgetState.modelContent`. Siblings preserve registration order. The async pump batches same-turn mutations, deduplicates identical payloads, coalesces in-flight changes, acknowledges only successful sends, and retries a dirty payload after the next mutation. MCP delivery remains capability-gated; ChatGPT delivery is selected when `window.openai.setWidgetState` is callable.

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
// views/product-search-result/view.tsx
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
  const { displayMode, availableDisplayModes, requestDisplayMode } =
    useDisplayMode();
  const sendFollowUpMessage = useSendFollowUp();
  const openExternal = useOpenExternal();

  // local UI state (iframe lifetime; not host-persisted — make model-visible via ModelContext)
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // server tool call from the view — name + args/result typed via Register
  const details = useCallTool("get-fruit-details");

  // view tool — the model can manipulate this UI while it is on screen
  useViewTool(
    {
      name: "highlight-fruit",
      description: "Highlight a visible result",
      inputSchema: z.object({ id: z.string() }),
    },
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
      {details.error && <ErrorBanner message={details.error.message} />}
      {details.data && <DetailsCard data={details.data.structuredContent} />}

      {availableDisplayModes.includes("fullscreen") &&
        displayMode === "inline" && (
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

Everything result-shaped enters through `useToolContext` (typed by the server's `outputSchema`; `query` is there because the handler echoes it for model visibility); everything ambient or imperative goes through split hooks; the view→model paths (`ModelContext`, `sendFollowUpMessage`, view-tool results) are visible and explicit in the JSX. Static tools must be exported into the `Register`. For tools that cannot be statically exported because they are registered dynamically, the explicit escape hatch applies with hand-written types: `useDynamicTool<{ fruit: string }, { name: string; producer: string }>("get-fruit-details")`.

### Hook surface (v1 → v2 → backing primitive)

| v1                                       | v2                                                                                                                               | Backed by                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `useWidget()`                            | split hooks (no aggregate)                                                                                                       | `App` events + `getHostContext()`                                    |
| — `props` / `toolInput` / `output`       | `useToolContext()` primary (`status` discriminant incl. `error`; `output` folds into `toolOutput`; args stream into `toolInput`) | `ontoolinput` / `ontoolinputpartial` / `ontoolresult`                |
| — `metadata`                             | `meta` on `useToolContext` when `ready` or `error` — view-only result channel                                                    | result `_meta` from `ontoolresult`                                   |
| — `partialToolInput` / `isStreaming`     | pending `toolInput` on `useToolContext` (`DeepPartial`; last write wins)                                                         | `ontoolinputpartial` / `ontoolinput`                                 |
| — `isPending`                            | `useToolContext().status === "pending"` (or pre-result / error branching)                                                        | input-received-but-no-result / pre-result state                      |
| _(no v1 equivalent)_                     | `useToolContext().status === "error"` + `ToolError`                                                                              | first `ontoolresult` with `isError: true`                            |
| — `theme` / `locale` / … / `isAvailable` | `useHostContext()`; `useViewTheme()` for theme-only                                                                              | `hostContext` + `onhostcontextchanged`                               |
| — `callTool`                             | `useCallTool()` (typed; preferred)                                                                                               | `App.callServerTool`                                                 |
| — `sendFollowUpMessage`                  | `useSendFollowUp()`                                                                                                              | `App.sendMessage` (`ui/message`)                                     |
| — `openExternal`                         | `useOpenExternal()` → `Promise<void>`                                                                                            | `App.openLink`                                                       |
| — `requestDisplayMode` / `displayMode`   | `useDisplayMode()` → `{ displayMode, availableDisplayModes, requestDisplayMode }`                                                | `App.requestDisplayMode` + `hostContext` + `viewConfig.displayModes` |
| `<McpUseProvider autoSize>` (v1)         | `viewConfig.autoResize` + `useSendSizeChanged()`                                                                                 | `App` `autoResize` constructor option + `App.sendSizeChanged`        |

| `useWidgetProps()` | `useToolContext()` — primary data API | bridge notifications → discriminated union |
| `useWidgetState()` | `useViewState()` — required object default, synchronous setter, shared per-view snapshot | ChatGPT `widgetState` persistence; MCP Apps iframe-lifetime state + `ui/update-model-context` |
| `useWidgetTheme()` | `useViewTheme()` | dedicated `hostcontextchanged` subscription |
| `useCallTool(name \| ref)` | kept, typed via `Register`/`ToolRef`; success-only `CallToolSuccess` data (typed `structuredContent` iff `outputSchema`); tool/transport errors reject | `App.callServerTool` |
| `useFiles()` | familiar `{ isSupported, upload, getDownloadUrl }` shape; no widget-state/model-visibility side effect | ChatGPT-only `window.openai` file extension |
| _(no v1 equivalent)_ | `useViewTool()` — view-registered tools the host/model calls (see View tools) | `App.registerTool` + temporary-handler handoff + `tools/list_changed` |
| `<McpUseProvider>` (v1) | removed — compose `ThemeProvider` / `ViewControls` / own boundaries; bootstrap owns connection + top-level error boundary | `viewConfig` for auto-resize / display modes |
| `<ThemeProvider>` | kept | ext-apps `applyDocumentTheme` / `applyHostStyleVariables` / `applyHostFonts` |
| `<WidgetControls>` | `<ViewControls>` | dev-only overlay, ported |
| `<ModelContext>` / `modelContext` | kept; nested text tree merges under `_uiContext` beside `useViewState` | `App.updateModelContext` or ChatGPT `setWidgetState` |
| `<ErrorBoundary>` | kept (bootstrap provides the required top-level boundary) | unchanged |
| `<Image>` | kept — resolves root-relative `src` via `__mcpUseViewConfig.publicBase` (Public assets) | `<img>` with absolute URL |
| `generateHelpers()` | dropped | subsumed by `Register` typing |

### Host-specific gaps

- **Cross-session view-state restoration:** ChatGPT restores `useViewState` through `window.openai.widgetState`. MCP Apps has no equivalent restoration channel yet, so the same hook keeps state for the current iframe lifetime and still exposes it to the model with `ui/update-model-context`.
- **`_meta.openai/*` emission** (`outputTemplate`, `widgetCSP`, invocation strings, …): overlay territory, out of the alpha (see Protocol posture).

---

## CLI integration

The full build/serve contract is "Build system & serving", above; it extends the **implemented** `CLI_SPEC.md` (which scoped views out) and its ground rules hold — reload-not-HMR for the server entry, `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk. Command summary:

- **`mcp-use dev`:** reconciles the managed root `mcp-env.d.ts`, then adds the Vite client environment to the existing dev server; public assets and Vite module graph serve through its middleware at `${basePath}/_mcp-use/`. View-file edits get Vite's own HMR (pure client code, sharing the one Vite dev server); server-entry edits follow the existing reload contract and invalidate all three primitive lists over the shared SDK event bus (decision 12). No tool-inspecting typegen hook runs.
- **`mcp-use build`:** reconciles the managed root `mcp-env.d.ts`, runs one client build per view, embeds the resulting registry in the generated wrapper entry, mirrors it in `.mcp-use/build/manifest.json` for runtime adapters, and runs the binding checks. External hashed assets under `.mcp-use/build/views/<name>/` are the default. `--inline` embeds the single-chunk JS and aggregated CSS in each resource instead.
- **`mcp-use typecheck`:** reconciles the same managed declaration, then runs the selected project's own TypeScript compiler with `--noEmit`. It does not execute the server or require a preceding dev/build command.
- **`mcp-use start`:** reads `entryPoint` from `manifest.json`, imports the built wrapper entry, and serves production view bundles plus public assets. It performs no Vite evaluation, view discovery, or runtime registry-file read. View documents are obtained only through `resources/read`.

## Testing

- **Type-level** (`tests/type-level.test.ts` pattern): `ToolRef` name/input/output inference incl. non-zod Standard Schema libs; `ToolsFromModule` filtering and re-export composition; `useCallTool` name union + arg/result types and `CallToolSuccess` success-only data (`structuredContent` typed iff the tool declares an `outputSchema`; no guarantee for schema-less tools); empty-`Register` fallback; `structuredContent` vs `outputSchema` agreement at the return position; `useToolContext` `pending | ready | error` narrowing (`pending` → `DeepPartial` input, `ready` → typed `toolOutput`, `error` → `ToolError`; no `toolName`); `useViewState` object-root/default/setter contract; input-schema vs output-schema type-source split; `DeepPartial` over arrays/nested objects; string / `ToolRef` / explicit-generic `useCallTool` overloads share the same result contract.
- **e2e over HTTP** (official client): view resource listing/reading with correct mimetype and framework auto-CSP in `_meta.ui.*` on both `resources/list` entries and `resources/read` content items for all clients; `tools/list` includes every registered tool for all clients (including `visibility: "app"` tools with `_meta.ui.visibility: ["app"]`); `ui.visibility` emitted only when top-level `visibility` is set (any tool); custom tool definition `_meta` coexists with generated view/visibility metadata, framework-owned collision values follow the declared contract, caller objects are not mutated or prototype-polluted, and per-request SDK reconstruction does not leak metadata between concurrent requests; **channel separation** — handler `{ structuredContent, content, _meta }` lands on the wire as `structuredContent` / `content` / `_meta` respectively, with handler `_meta` absent from everything model-facing; `_meta.ui.resourceUri` (plus legacy flat `"ui/resourceUri"`) auto-stamped on every completed non-error view-bound tool result; errors and intermediate `input_required` returns carry no resource-URI stamp; no custom tool-name metadata on results.
- **Build/serve** (CLI-test pattern from `tests/cli/`, real build against a views fixture): without `--inline`, hashed JS/CSS under `.mcp-use/build/views/<name>/assets/`, a `kind: "external"` registry, and absolute `<script>`/`<link>` URLs remain the default; with `--inline`, the registry contains bundled JS/CSS source, no per-view asset directory is written, and `resources/read` emits inline module/style tags. Both modes generate no HTML file, use the embedded registry for `resources/list` and `resources/read`, preserve copied public assets, and run the same binding checks. External mode additionally verifies production asset routes, CDN rewriting, correct content types, cache headers, CORS, `HEAD`, containment, and missing-asset `404`s. Missing view, missing `outputSchema`, and duplicate binding fail; an unbound view warns but remains listed/readable.
- **Bridge-level / runtime:** a minimal `AppBridge` drives initialize; progressive partial and complete inputs replacing pending `toolInput`; first structured result latching `ready`; first tool error latching `error`; content-only success and cancellation leaving pending unchanged; every notification ignored after terminal latching; direct `useCallTool` and `useViewTool` responses followed by compliant host lifecycle notifications; schema-backed View-tool validation and schema-less `{}` callback adaptation; request-scoped raw capability, extension, client-info, and `supportsViews()` checks with no cross-request leakage; split-channel rerender isolation; ChatGPT files plus widget-state restoration/subscription; shared `useViewState` updates; merged nested `ModelContext` payloads; View-tool registration lifecycle; bootstrap/disposal; and size reporting.

## Deltas vs v1 (for the migration guide)

1. Every `widget` name → `view` (`widget:` config, `useWidget*`, `WidgetControls`, `ui://widget/…` → `ui://views/…`). The v1 `widget()` response helper remains as a deprecated shim that returns a plain `CallToolResult`; prefer writing that shape directly.
2. `useWidgetProps()` → latched `useToolContext()` (`pending | ready | error`; partial and complete args share a `DeepPartial` pending `toolInput`); `useWidget()` → split data, host, and action hooks. Components mount once. The first structured result becomes typed `toolOutput`; content-only ambient successes are ignored; `ToolError` owns the error branch.
3. View files default-export the component and may export immutable `viewConfig` (auto-resize / display modes). Result types come from `outputSchema` via `useToolContext<Name>()` (required on view-bound tools). Resource facts (description, CSP, permissions, domain, prefersBorder) are declared on the single binder's `view:` config and emitted on the resource. Each view binds at most one tool.
4. In-component `isPending` skeleton branching → `useToolContext()` `pending` / `ready` / `error` branching inside the always-mounted default export.
5. `useCallTool` types come from exporting tool refs, not from generated `.mcp-use/generated/tool-registry.d.ts`; template `postinstall`/dev-loop typegen is gone. `callTool` resolves every non-error result (`CallToolSuccess`; `structuredContent` typed iff the tool declares an `outputSchema`); `ToolError` and transport/RPC/capability failures reject.
6. `useWidgetState` → `useViewState`. The new hook requires an object default, shares one snapshot across components in the mounted view, restores on ChatGPT, and remains iframe-lifetime on MCP Apps hosts.
7. `useFiles` retains the familiar v1 upload/download shape, but drops the `modelVisible` option and widget-state mutation.
8. `window.openai` is consumed only for capabilities without a standard restoration channel: files and ChatGPT-persisted `useViewState`. All other baseline view behavior continues through MCP Apps.
9. Tool config `invoking`/`invoked`/`widgetAccessible` removed (openai overlay, no spec equivalent; `visibility` covers app/model narrowing).
10. Views work against the stateless 2026-07-28 wire; nothing view-related depends on sessions.
11. Asset routes move from `${basePath}/mcp-use/widgets/…` to two framework-owned spaces: `${basePath}/_mcp-use/views/<name>/…` for default hashed production bundles and `${basePath}/_mcp-use/public/…` for project-public files. Each view has an independent client build with no shared chunks. Hosts obtain the HTML document only through `resources/read`; by default it loads external JS/CSS from the view route or full CDN URLs embedded when `MCP_ASSETS_URL` is set at build time, while `build --inline` places JS/CSS directly in the document. `MCP_URL` selects the server origin, while `MCP_ASSETS_URL` selects the external asset prefix and may include a path. One request-scoped `globalThis.__mcpUseViewConfig` supplies `publicBase`; no origin is baked into that runtime config at server startup.
12. Registration no longer happens inside `listen()` or first-request setup (v1's async `mountWidgets` → `server.uiResource()`): the build primes the instance through a generated wrapper entry, and `resources/read` synthesizes the document from embedded registry data instead of reading built HTML from disk. `server.uiResource()` has no v2 equivalent, and neither do v1's `exposeAsTool` / hand-built `uiResource` registrations — at most one tool binds a view via `view: { name }`, and an unbound view warns (decision 10).
13. Ambient hooks split by concern: `useHostContext()`, `useSendFollowUp()`, `useOpenExternal()`, `useDisplayMode()`, `useSendSizeChanged()` — split-by-concern is the design; each hook rerenders only on its channel (action hooks return stable runtime-owned callbacks). v1's aggregate `<McpUseProvider autoSize>` is replaced by `viewConfig.autoResize` plus direct composition of `ThemeProvider` / `ViewControls`.

## Open questions

- Stable `ui://views/<name>.html` vs content-hashed URIs: revisit only with evidence that a target host over-caches by URI (v1's `buildId` existed for ChatGPT; ChatGPT's MCP Apps path may not need it). External evidence: Skybridge appends `?v=<content-hash>` to view URIs in production — a second framework independently concluding hosts over-cache by URI. Expectation is this resolves toward a registry-derived hash suffix once tested against ChatGPT; still deferred to that test, not decided here.
- `ui/download-file` (draft) exposure — as a standalone hook — once a target host ships it.
- Partial/streamed **tool results**: not in the 2026-07-28 protocol or the apps spec today (see Streaming). When a partial-result channel lands upstream, deliver it as ordinary `useToolContext` re-renders; until then, progressive UIs pull via `useCallTool`.
- **Vite dev `script-src` / eval:** Vite HMR and some dev transforms use `eval`, which strict host `script-src` policies may block. The MCP Apps CSP shape is origin-lists only — no `'unsafe-eval'` or nonce slot — so this cannot be declared in `view.csp`. If it bites in practice, the fix is Vite-side (jitless deps, no eval-based sourcemaps); dev already auto-appends the HMR websocket origin to `connectDomains` (Serving).
- Sampling from views (`createSamplingMessage`, draft) — post-alpha, follows the server package's sampling posture (`SPEC.md`, elicitation & context phase).
- Overlay mechanism shape (if a host demands `openai/*` keys): registration-boundary transform, opt-in per server or per host detection — design when needed.
