# @mcp-use/server — Views (MCP Apps) spec

**Status:** design contract, pre-implementation. Companion to `SPEC.md` (whose views phase points here) and `CLI_SPEC.md` (the implemented `dev`/`build`/`start` base contract this document extends).
**Scope:** the views runtime in the server package, view resources and protocol metadata, the React view runtime (`/react` subpath), the zero-codegen typing layer (`ToolRef` / `Register`), and the views half of the `dev`/`build`/`start` contract.
**Tracking:** Linear MCP-2601 (Views & MCP Apps + typing), MCP-2180 (widget→view naming).
**v1 reference:** `packages/mcp-use` (`src/react/`, `src/server/widgets/`) defines *what* views must be able to do, never how. Parity with v1 is the alpha goal; the architecture is not carried over.

## Decisions at a glance

1. **One protocol: MCP Apps.** The [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) (`io.modelcontextprotocol/ui`, spec revision `2026-01-26` + draft) is the only wire format. The v1 adapter system (`AppsSdkAdapter`, dual-protocol metadata, `window.openai` transport) is **not ported**.
2. **Public naming is "view", everywhere.** `view` tool config, `useToolContext` hook, `ui://views/…`. "Widget" survives nowhere in the v2 API.
3. **`tool()` returns `ToolRef<Name, Input, Output>`** (not `this`). Typed `useCallTool` is pure type inference over exported refs — zero codegen, nothing generated on the dev/build hot path.
4. **Hook-first view data.** The default export mounts when the bridge connects — before any tool result — and stays mounted for the iframe lifetime; the runtime never spreads props onto it. `useToolContext<Name>()` is the primary data API: a discriminated union over `pending` / `streaming` / `cancelled` / `ready` that carries a single streaming `toolInput` field (partial args and complete args share the field; last write wins), typed `toolOutput` after the result, a `toolName` discriminant (authoritative on `"ready"` from the result stamp; informational earlier), plus `content`, view-only `meta`, and an optional cancellation `reason`. Split hooks cover host context and actions; there is deliberately no aggregate hook — v1 `useWidget` migrates onto the split hooks.
5. **The React runtime builds on `@modelcontextprotocol/ext-apps`** (guest `App` class); the server package **inlines** the few wire constants and emits spec `_meta` itself — no ext-apps import server-side.
6. **No response helpers — views included.** The no-response-helpers ground rule (`SPEC.md`) applies without exception. View-bound tool handlers return a plain `CallToolResult`: `{ content, structuredContent, _meta? }`. `structuredContent` is typed by the tool's `outputSchema` at the return position (existing `ToolResult<TOutput>` machinery).
7. **React runtime ships as the `/react` subpath** of this package, with `react` an optional peer — tool-only servers never pay for it.
8. **Parity with v1 hooks, minus two named gaps** (file upload, cross-session view state) that the MCP Apps spec cannot express — see "Dropped from v1".
9. **Views build into `.mcp-use/build/views/` and serve under `${basePath}/_mcp-use/`.** One self-contained Vite client build per view (JS + CSS inlined into the synthesized document — zero asset fetches at srcdoc boot so the app initializes before/early-into argument streaming; hosts drop pre-`ui/initialize` notifications per ext-apps AppBridge; matches the Excalidraw MCP App reference design; trade-off: no shared chunks across views), a manifest-driven registration + serving path identical for `start` and serverless, request-scoped origin for public assets / CSP. v1's `mcp-use/widgets` routes are not carried over — see "Build system & serving".
10. **Many tools may bind one view; every binder declares an `outputSchema`; resource facts have one authoring point.** Any number of tools may declare `view: { name: "same-view" }` — sharing one rendered surface across several tools (e.g. a model-visible `draw` plus an app-only `refresh` on one canvas) is first-class. Every view-bound tool still requires an `outputSchema` (hard error otherwise). At most one binder may declare facts beyond `name` (`description`, `csp`, `permissions`, `domain`, `prefersBorder`); a second facts-declaring binder for the same view is a **hard error** at registration naming both tools — additional binders write `view: { name }` only, so the view resource's wire facts stay order-independent. A `view:` naming a missing view directory is a **hard error** (broken `resourceUri`). A view directory no tool binds is a **warning only** (unused-code class: harmless dead weight, and erroring would break the scaffold-view-first authoring order and make feature-flagging a tool off a deploy-breaking action). Many-to-one is safe because the result `_meta["mcp-use/toolName"]` stamp plus `useToolContext`'s `toolName` discriminant keep typing honest across binders, and the single facts-authoring point keeps the resource deterministic.
11. **Views register from the manifest as code — no filesystem on any MCP path.** `mcp-use build` bakes the views manifest into a generated wrapper entry that primes the server instance before anything mounts; `resources/read` and the document route synthesize the HTML from manifest data per request. No runtime `fs` read, and deliberately no fallback — an unprimed `view:` is a loud mount-time error. See "Registration mechanism".
12. **Dev shares the one Vite dev server `mcp-use dev` already runs.** The views client environment joins that server; view-file edits get real Vite HMR with **React Fast Refresh** (component state survives edits — `@vitejs/plugin-react` is an optional peer, auto-injected in dev unless the user's Vite config already registers it), while the server entry keeps the implemented reload-and-swap contract (`CLI_SPEC.md`). Emitting `tools/list_changed`/`resources/list_changed` to connected clients on dev reload is **deferred** (it needs the notifications phase; under the stateless wire the next `tools/list` is always current anyway).
13. **Tool visibility is a top-level `ToolDefinition` field.** `visibility?: "model" | "app"` lives on the tool itself (`server.tool({ name, visibility: "app", … })`), not inside `view:`. Emitted as `_meta.ui.visibility: ["model"] | ["app"]` on `tools/list` for any tool that sets it — view-bound or not — and omitted entirely when unset (host default: callable by the model, visible to the app). The server always lists every registered tool; filtering is host policy (MCP Apps: hosts MUST hide `visibility: ["app"]` tools from the model and MUST reject app `tools/call` for tools without `"app"`). Never on tool results. App-private helper tools (e.g. `save-checkpoint`) are plain tools with `visibility: "app"` and usually no `view:` binding — the view calls them via `useCallTool` and their results return to the caller; a `view:` binding is only for tools whose results should render the view.

---

## The running example

Used throughout this document. One tool, one view, one schema — every snippet below agrees with this shape:

```ts
// src/index.ts (server entry)
import { MCPServer } from "@mcp-use/server";
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
import { useToolContext } from "@mcp-use/server/react";

export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();
  if (view.status !== "ready") {
    return (
      <SearchSkeleton
        query={view.toolInput?.query}
        pulsing={view.status === "streaming"}
      />
    );
  }
  return <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />;
}
```

Note what makes this consistent: during streaming, `query` arrives via `toolInput` (fed by the tool's **input** schema — partials and the complete input share one field); after the result, `view.toolOutput` is exactly `structuredContent` (typed by `outputSchema`) — never a merge of the two channels. The handler still echoes `query` into the output so the model sees it; the pre-result window no longer depends on that echo.

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
| tool result `_meta` (view-bound `tools/call`, non-error) | `"mcp-use/toolName"` | `"<tool name>"` — the calling tool's name (sibling of `ui` on result `_meta`); lets the view discriminate which binder delivered the result (`ui/notifications/tool-result` carries no tool identity) |
| resource (`resources/list` entry) | `description`                                    | from the facts-declaring binder's `view.description`                     |
| resource (`resources/list` entry) | `mimeType`                                       | `text/html;profile=mcp-app`                                  |
| resource (`resources/list` entry) `_meta` | `ui.csp`                             | `{ connectDomains, resourceDomains }` — author domains from the facts-declaring binder's `view.csp`, plus the request-resolved serving origin auto-appended to `resourceDomains`; in dev, the serving origin's websocket variant (`ws://`/`wss://`) is also auto-appended to `connectDomains` (see Dev) |
| resource (`resources/list` entry) `_meta` | `ui.permissions`                     | from the facts-declaring binder's `view.permissions` when set            |
| resource (`resources/list` entry) `_meta` | `ui.domain`                          | from the facts-declaring binder's `view.domain` when set                 |
| resource (`resources/list` entry) `_meta` | `ui.prefersBorder`                   | from the facts-declaring binder's `view.prefersBorder` when set          |
| resource content item (`resources/read` `contents[]`) | `mimeType` | `text/html;profile=mcp-app`                                  |
| resource content item (`resources/read` `contents[]`) | `text`     | synthesized HTML document (origin-resolved per request)      |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.csp` | same shape as the list entry; **content-item value takes precedence** per MCP Apps spec — request-resolved serving origin (and dev HMR websocket origin in `connectDomains` when dev-primed) |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.permissions` | same as list entry when set |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.domain` | same as list entry when set |
| resource content item (`resources/read` `contents[]`) `_meta` | `ui.prefersBorder` | same as list entry when set |

Security metadata (CSP, permissions, domain, prefersBorder) lives on the **resource**, never the tool — hosts ignore tool-level copies per spec. Authors declare external domains in the facts-declaring binder's `view.csp`; the framework appends its serving origin to `resourceDomains` at emission time. Spec-canonical hosts read `UIResourceMeta` from each `resources/read` content item's `_meta.ui` (the list entry is a static fallback; the content-item copy takes precedence). Both surfaces carry the same author facts; the read-time copy uses the per-request resolved origin so CSP always matches the synthesized HTML's asset URLs.

### Capability gating (stateless-first)

Per the `SPEC.md` stateless posture, UI support is a **request-scoped** fact: the 2026-07-28 wire carries `clientCapabilities` in per-request `_meta`, and MCP Apps support is `capabilities.extensions["io.modelcontextprotocol/ui"]` advertising `mimeTypes: ["text/html;profile=mcp-app"]`. Nothing is ever inferred from remembered sessions.

**The wire surface is unconditional.** `tools/list` always includes every registered tool regardless of client capabilities or top-level `visibility`. View-bound tools always carry `_meta.ui.resourceUri` (plus the legacy flat `"ui/resourceUri"` key) on `tools/list`, and every non-error result from that tool is stamped with the same link keys plus `"mcp-use/toolName"` — regardless of whether the client advertises the UI extension. View resources always carry `_meta.ui` (framework auto-CSP with the serving origin) on both `resources/list` entries and each `resources/read` content item. When a tool's top-level `visibility` is set, `_meta.ui.visibility` is emitted as a declaration (`["model"]` or `["app"]`); filtering by that declaration is **client policy** — the server never omits tools from `tools/list`.

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

As of the current ext-apps release, no published version supports the v2 SDK — it peer-depends on `@modelcontextprotocol/sdk@^1.x` (v1); the upstream v2-port PRs (#612, #614) were closed unmerged in favor of a not-yet-landed "SDK divorce" (vendoring the `Protocol` shim and types). Consequences:

- **Server side: write our own — deliberately, and it is small.** Ext-apps' server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`) take a v1 `McpServer` we don't have, and they were always thin sugar over registration this framework does itself. Our replacement: inlined wire constants (mimetype, `_meta.ui.*` keys, extension ID), `_meta` emission at tool/resource registration, and a `getUiCapability` equivalent over per-request `extensions["io.modelcontextprotocol/ui"]` — on the order of 100–200 lines. Server-side types use **type-only imports** of the canonical ext-apps types (`McpUiResourcePermissions`, `McpUiResourceCsp`) from `@modelcontextprotocol/ext-apps` — zero runtime reach into ext-apps, so the `SPEC.md` "no v1 SDK imports" ground rule is preserved. Published declarations reference those ext-apps types; tool-only projects without ext-apps installed see `UiPermissions` and `csp` degrade to `any` under `skipLibCheck` — acceptable because those fields only matter for views projects, which declare ext-apps.
- **View side: reuse essentially the whole guest protocol stack.** The React runtime wraps ext-apps' `App` + `PostMessageTransport`: handshake, capability negotiation, the event system with one-shot replay, all outbound methods (`callServerTool`, `sendMessage`, `openLink`, `requestDisplayMode`, `updateModelContext`, `sendLog`, `downloadFile`, size-changed/auto-resize, teardown), the complete app-tools implementation (`registerTool` — see View tools), style helpers, and the `McpUi*` types. The v1-SDK incompatibility does not bite here: the view never speaks the MCP wire — it speaks apps-spec postMessage to the *host* — so the v1 SDK inside is internal plumbing (`Protocol` base class, types, zod) that Vite tree-shakes into the view's **static browser assets** (the SDK's express/hono/ajv tree is unreachable from `app.ts`). A view built on the current ext-apps release works against a 2026-07-28 server. Our `/react` code is product surface only — hooks, the generated mount wrapper, typing layer, dev overlay — no protocol code.
- **Host side (inspector, test harness): reuse `AppBridge` with `client: null`** — its explicit escape hatch for hosts without a v1 `Client`; request handlers (`oncalltool`, `onlistresources`, …) forward to the v2 client stack manually.
- **Dependency mechanics:** ext-apps (1.4 MB, one hard dep) is an **optional peer** of this package — the `vite` pattern from `CLI_SPEC.md`. View projects declare it (template does); tool-only servers install neither it nor its v1-SDK peer tree (~4.3 MB + express/hono/ajv/jose transitives), keeping the install-budget ground rule honest. Fallback if peer noise warrants: ext-apps' `app-with-deps`/`react-with-deps` bundled entries (cost: zod dedupe). When upstream's SDK divorce lands, the peer disappears and bundles shrink with no API change on our side.

---

## Server API

### File-based views (the first-class authoring path)

View components live under `resources/` (fixed convention, one directory per view, `view.tsx` as the component entry — the directory is named for what views *are* on the wire: MCP resources). There is deliberately no `viewsDir` knob in the alpha, matching `CLI_SPEC.md`'s no-config-file rule; a constructor field can be added later without breaking anything.

```
resources/
  product-search-result/
    view.tsx        # default-exports the component
    types.ts        # any other files in the directory are ordinary modules the view may import
```

A view file has two recognized exports: the **default export** — the component, mounted for the iframe lifetime and reading data through hooks (see Component lifecycle & view data) — and an optional **`viewOptions` named export** for guest-runtime bridge options (currently `autoResize`; see Providers and components / `useSendSizeChanged`). `viewOptions` is iframe behavior only — never wire metadata — so it does not reintroduce v1's server-parses-widget-files problem. Resource facts (description, CSP, permissions, domain, prefersBorder) live exclusively on the facts-declaring binder's server-side `view:` config (decision 10). Result types flow from each binder's `outputSchema` via `useToolContext<Name>()` — a name union when several tools bind the same view.

Discovery registers one `ui://views/<dir-name>.html` resource per view; any number of tools may bind it (decision 10; an unbound view warns). The **build/dev manifest is the source of truth** for what views exist and what asset each serves — production never rediscovers the filesystem and never re-reads the manifest either: it reaches the runtime as code (Registration mechanism, below). Nothing depends on `handler.toString()`.

Inline JSX returned from tool handlers is a documented **stretch** authoring model and is out of this contract; it must layer on the file-based path without changing it.

### Binding a tool to a view

The `view:` config on `server.tool()` binds the tool to a view resource. Resource wire facts (`description`, `csp`, `permissions`, `domain`, `prefersBorder`) are authored on **at most one** binder for that view — additional binders write `view: { name }` only (decision 10). Tool visibility is a separate top-level `ToolDefinition` field (`visibility?: "model" | "app"`), not part of `view:` (decision 13). The view file exports the component (plus optional guest-runtime `viewOptions`); the framework reads the facts-declaring binder's `view:` fields at registration and emits them on the view's MCP resource (where hosts read them per spec — tool-level copies are ignored).

```ts
// tool-level (any tool — view-bound or not):
visibility?: "model" | "app";      // → _meta.ui.visibility on tools/list; omitted = host default (model + app)

view: {
  name: string;                    // view directory name, e.g. "product-search-result"
  description?: string;            // → resource description on resources/list and resources/read (facts-declaring binder only)
  csp?: {                          // → resource _meta.ui.csp (framework auto-appends serving origin to resourceDomains)
    connectDomains?: string[];
    resourceDomains?: string[];
  };
  permissions?: UiPermissions;     // → resource _meta.ui.permissions
  domain?: string;                  // → resource _meta.ui.domain
  prefersBorder?: boolean;         // → resource _meta.ui.prefersBorder
}
```

Authors declare every external domain the view loads in the facts-declaring binder's `view.csp.resourceDomains` (and fetch targets in `connectDomains`). The framework always emits `csp` on the resource and appends its request-resolved serving origin to `resourceDomains` so the view's own built assets are loadable. Hosts enforce CSP strictly — undeclared domains are blocked.

Binding rules (decision 10), enforced where the wire would lie — at registration in dev, at build in prod:

- `view.name` naming a missing view directory is a **hard error** (broken `resourceUri`).
- A `view:` tool without an `outputSchema` is a **hard error** — the output contract *is* the `outputSchema` (`useToolContext<"search-fruits">()` reads it; a multi-binder view uses a name union and narrows via `toolName`). A view that takes no result payload binds to a tool with an empty object schema (`outputSchema: z.object({})`).
- Any number of tools may bind the same view. At most one binder may declare facts beyond `name`; a second facts-declaring binder for the same view is a **hard error** at registration naming both tools — additional binders write `view: { name }` only, so the resource's wire facts stay order-independent.
- A view directory no tool binds is a **warning naming the view**, never an error — nothing on the wire is wrong (no host renders a view except through a tool result's `_meta.ui.resourceUri`), and erroring would punish the natural authoring order (view directory first, tool second) and turn feature-flagging a tool off into a build/deploy breaker. Unbound views are still built, registered, and served — `resources/read` and the document route staying live is useful for inspector preview of not-yet-wired views.

The check itself is a set difference at mount time — the frozen tool registry against the primed view registry — re-run per dev reload. Many-to-one binding is first-class: the result `_meta["mcp-use/toolName"]` stamp and `useToolContext`'s `toolName` discriminant keep typing honest across binders, and the single facts-authoring point keeps the resource deterministic.

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

The handler and the view component are two ends of one call: `structuredContent` is forwarded to the bound view; `useToolContext<Name>()` surfaces it as `toolOutput` when `status === "ready"`. The server side checks `structuredContent` against `outputSchema` at the return position; the view side types the ready branch from the same schema — both ends check against one type, so they cannot drift.

**Auto-stamping result `_meta`.** The framework auto-stamps `_meta.ui.resourceUri` (plus legacy flat `"ui/resourceUri"`) and `_meta["mcp-use/toolName"]` (the calling tool's name) onto every non-error result of a view-bound tool — the URI so clients know an MCP App can render, the tool name so the view can discriminate which binder delivered the result (`ui/notifications/tool-result` carries no tool identity). Handlers may pass additional keys on `_meta` for view-only data. On collision, wire keys win over handler keys; the reserved namespaces are `ui.*` and `mcp-use/*`.

### Channel visibility: what the model sees vs what the view sees

The full `CallToolResult` reaches the view (the host forwards it via `ui/notifications/tool-result`); what reaches the **model** is host policy, but the spec's design assumption — and ChatGPT's behavior — is: `content` and `structuredContent` are model-facing, `_meta` is not. Design for that split; never put secrets in any tool result channel (the view is still client-side).

| Data | Model | View | Text-only host | Carried as |
| --- | --- | --- | --- | --- |
| `structuredContent` | ✅ | ✅ (`useToolContext().toolOutput` when `ready`) | host may render raw | `structuredContent`, typed by `outputSchema` |
| `content` | ✅ | ✅ (`useToolContext().content` when `ready`) | ✅ (the fallback) | `content` blocks |
| result `_meta` (handler keys) | ❌ | ✅ (`useToolContext().meta` when `ready`) | ❌ (ignored) | result `_meta` |
| tool input | ✅ (it authored it) | ✅ (`useToolContext().toolInput` — partial while streaming, complete after `tool-input`) | ✅ | `tools/call` arguments |
| view-tool result | ✅ (it called the tool) | source | n/a | `tools/call` over the bridge → `useViewTool` handler |

Consequences worth spelling out in docs:

- **`structuredContent` is model-visible.** That is a feature — the model reasons over exactly what the user is looking at — but it prices structured output in tokens and rules it out for bulk payloads. The dividing question for every field: *should the model see this?* Yes → `structuredContent`; no (bulk, presentation-only, e.g. base64 images, geometry, full result sets beyond what's discussed) → `_meta`.
- **`content` is the model/text-host narrative** ("Found 12 results, top match …"). Handlers should pass a short summary; since `structuredContent` is already model-visible, omitting `content` leaves text-only hosts with only the structured payload.
- **Result `_meta` is the view-only channel**: handler-supplied keys are preserved on result `_meta`, read via `useToolContext().meta` when `ready`, never typed by `outputSchema`, never model context. The framework also stamps the wire `ui.*` link keys (`ui.resourceUri`, `"ui/resourceUri"`) and `_meta["mcp-use/toolName"]` onto every non-error result from a view-bound tool — the tool name never enters model context. The reserved namespaces are `ui.*` and `mcp-use/*`; wire keys win on collision.
- The reverse direction is explicit, not ambient: nothing a user does *inside* the view reaches the model unless sent via `sendFollowUpMessage` (`ui/message`, triggers a turn) or returned from a view tool (*model-initiated*, see View tools). The spec's third path — the `ui/update-model-context` push — is not exposed in the alpha; its API is deferred with the state-management design (see "Dropped from v1").

### URI scheme and serving

- Resource URI: `ui://views/<name>.html` — stable across builds. (v1 embedded a `buildId` for ChatGPT's per-URI caching; that is an overlay concern. If host caching demonstrably requires it, a content-hash suffix comes back via the manifest — deferred to implementation evidence, see Open questions.)
- The resource body is a complete HTML document (rendered by hosts via `srcdoc`). In **production** the document is fully self-contained: view JS and CSS are inlined (`<script type="module">` / `<style>`) so the iframe boots with zero network fetches for the view bundle. In **dev** the same shell loads Vite module URLs (`/@vite/client` + the virtual entry) for HMR. The document is **synthesized per request from the manifest entry** — never read from disk (see "Registration mechanism"). Public-folder assets still load over HTTP from `${basePath}/_mcp-use/public/`. The full contract — build pipeline, routes, origin derivation, caching — is "Build system & serving", below.

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
      "text": "<!doctype html>…",        // ← origin-resolved per request, identical to the HTTP document route (see Serving)
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

Resource `_meta.ui` carries author facts from the facts-declaring binder's `view:` config plus the framework's auto-appended serving origin in `csp.resourceDomains`. Fields the author did not set (`permissions`, `domain`, …) are omitted. The list entry and each read content item emit the same author facts; the read-time copy resolves the serving origin per request so CSP always matches the synthesized HTML. Clients without the UI extension still receive `ui.*` metadata on view resources, view-bound tools, and every tool on `tools/list` (including tools with top-level `visibility: "app"`, which carry `_meta.ui.visibility: ["app"]` for the host to filter).

---

## Build system & serving

Extends `CLI_SPEC.md`'s implemented workspace and command contract (its ground rules hold: `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk, no config file, fixed `.mcp-use/` layout). v1 reference: `packages/cli` `buildWidgets` + `packages/mcp-use/src/server/widgets/*` define what the pipeline must deliver — built assets, a manifest, HTTP serving, dev HMR — never how. The v1 mechanics (scratch `entry.tsx`/`index.html` files in `cache/`, boot-time origin baking, regex rewriting of built HTML, `window.__getFile` indirection, auto-injected Tailwind) are **not** carried over.

### One self-contained client build per view

`mcp-use build` gains a **client environment** alongside the existing node/SSR build — **one Vite build invocation per discovered view**, each producing a single self-contained ES module. Entries are **virtual modules** (`virtual:mcp-use/views/<name>`, resolved by the views plugin inside `src/cli/`), not scratch files: each imports the runtime's iframe bootstrap from the `/react` runtime and the view module, and mounts per the Component lifecycle & view data contract (bridge connect, always-mounted default export, `tools: { listChanged: true }` capability). Nothing is written to `cache/` for entries; nothing user-visible is generated.

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

**User Vite config:** if the project has a `vite.config.ts`, the client environment resolves it normally and layers the views plugin on top — Tailwind, path aliases, and friends are the user's declaration, not framework magic (v1 silently injected Tailwind v4 + a generated `styles.css`; v2 templates declare `@tailwindcss/vite` themselves). The node/SSR environment ignores user client plugins per standard environment scoping.

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

View JS/CSS do not travel as separate HTTP assets in production (they are inlined). Public-folder files and the optional asset route still use path spaces:

- **On disk**, `public/` is copied to `.mcp-use/build/views/public/`.
- **On the wire**, public files are addressed at `GET ${basePath}/_mcp-use/public/<path…>`. The asset route `GET ${basePath}/_mcp-use/assets/<file>` remains for residual build artifacts and tooling; production view documents do not depend on it for the view bundle.

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
import { registerViews } from "@mcp-use/server";
server[registerViews]({
  "product-search-result": { kind: "inline", js: "…", css: "…" },
});
export default server;
```

Because priming happens during module evaluation of the built entry, it is complete before any downstream `getHandler()`/`listen()` call — and because it is part of the JS module graph, every bundler and file tracer (Vercel's nft, esbuild, Wrangler) carries it automatically. Per mode:

- **`start`:** imports the built entry; views are primed by the wrapper before `listen()`. Nothing new in the `start` contract.
- **Serverless:** the function entry imports `.mcp-use/build/index.js` (not the TS source — a views deployment necessarily has a build step, since the inline bundles only exist post-build). Identical code path to `start`; the MCP surface (list/read/tool meta) needs **zero filesystem** at runtime.
- **Dev:** no wrapper — the CLI calls the same internal API on each freshly loaded instance (the module runner constructs a new `MCPServer` per entry reload) before wiring it into the swappable handler, feeding it the in-memory view registry (`kind: "external"`) and `{ dev: true }` so HMR websocket origins are emitted in resource CSP. View add/remove triggers the existing reload-and-swap; view *code* edits never touch registration (pure client HMR).

**No fallback, loud errors.** There is deliberately no `fs` path anywhere on the MCP surface and no degraded mode: a tool declaring `view: { name }` on an instance with no primed views — or a name the primed registry doesn't contain — is a mount-time error naming the view and the fix (`run mcp-use build` / deploy the built entry). Cautionary precedent: Skybridge keeps a `readFileSync(manifest)` fallback for when priming was skipped, and it degrades *silently* in exactly the environments where it can't be debugged — serverless bundles that don't include the JSON, or any process whose cwd differs from the build layout; tools keep working, views render blank. That failure class is not made unlikely here; it is made inexpressible.

**Consequence, documented:** views make `mcp-use build` mandatory for deployment. The ships-unbuilt serverless shape (function entry importing the TS source directly, per the current `examples/vercel`) remains valid for tool-only servers; the views variant of the example imports the built entry.

### Serving

All framework HTTP surface lives under **`${basePath}/_mcp-use/`** — a framework-owned namespace inside the one mount point users already expose (underscore prefix = private-by-convention, the `_next` analog; v1's `${basePath}/mcp-use/widgets` naming is dropped). Everything under `basePath` means the existing handler covers MCP + assets with zero extra routing config on any platform — one Hono app, one serverless function, one exposed path prefix.

| Route | Serves | Cache-Control |
| --- | --- | --- |
| `GET ${basePath}/_mcp-use/views/<name>.html` | the view document, synthesized from the manifest entry and origin-resolved per request (same body as `resources/read`) | `no-store` |
| `GET ${basePath}/_mcp-use/assets/<file>` | residual build artifacts by basename (optional; production view documents do not load view JS/CSS from here) | `public, max-age=31536000, immutable` |
| `GET ${basePath}/_mcp-use/public/<path…>` | static files from the project-root `public/` directory (Public assets, below) | `public, max-age=0, must-revalidate` |

Asset and public responses include `Access-Control-Allow-Origin: *`. Hosts render views in sandboxed cross-origin iframes (`srcdoc`); module scripts and other fetches run in CORS mode, so permissive ACAO on these public static files is required when anything still loads over HTTP (public assets; dev Vite modules). Dev has the same requirement on its Vite-served module URLs — hosts rendering through the tunnel fetch them from foreign origins — but there the header is emitted only while the tunnel is active, keeping an unexposed dev server's module graph (source, not built assets) unreadable cross-origin (CLI_SPEC.md § DNS-rebinding protection).

The HTML route exists for hosts that navigate an iframe to a URL, for the inspector, and for humans debugging in a browser; MCP hosts normally take the document from `resources/read`. View document responses do not emit ACAO (hosts load them via `resources/read` or iframe navigation, neither of which uses CORS).

**Document synthesis** branches on the manifest entry kind:

- **`inline` (production):** emit `<style>` with the CSS (escaping `</style`) and `<script type="module">` with the JS (escaping `</script` → `<\/script` and `<!--` → `\x3C!--`). Keep the `__mcpUseViewConfig` config script (`publicBase` still origin-resolved per request) and `<div id="root">`.
- **`external` (dev):** `<link>` / `<script type="module" src>` tags for Vite module URLs (current HMR path).

**Origin resolution is request-scoped** — the same posture as capability gating, and the piece v1 got structurally wrong (origin computed once at boot from `MCP_URL`/host:port, then string-patched into HTML). The synthesized document's `publicBase` (and any residual absolute URLs) resolve per request to `<origin>${basePath}/_mcp-use/` where `<origin>` comes from, in order: an explicit override (for deployments whose edge doesn't forward — **shape deliberately unresolved**: whether this is a `publicUrl` config field or v1's `MCP_URL` environment variable is a pending separate discussion, see Open questions), standard `Forwarded`/`X-Forwarded-Proto`+`X-Forwarded-Host` headers, the request URL itself. The v1 mistake was *when* the override was read (boot-time baking), not the override existing; whatever its spelling, it is applied at emission time. No boot-time state — correct behind tunnels/proxies/preview deployments without restarts.

**srcdoc iframes have no document base URL.** Hosts render view documents via `srcdoc`, so every URL the view still loads over the network (public assets; in **dev**, Vite modules) must be absolute — root-relative paths resolve against the *host page* origin, not the MCP server. Production view JS/CSS need no network URLs (inlined). Dev sets Vite `server.origin` to the dev server's browsable origin so imported assets emit absolute `http://…` URLs. Public assets resolve through a request-scoped config global injected into the synthesized document.

**CSP consequence:** hosts sandbox the view iframe and enforce the resource's `ui.csp` from the `resources/read` content item's `_meta.ui` (content-item value takes precedence; the list entry is a static fallback). Authors declare external domains in the facts-declaring binder's `view.csp`; the registration layer **auto-appends the request-derived serving origin** to `csp.resourceDomains` when emitting resource `_meta` on both `resources/list` and each `resources/read` content item so public assets/images from the serving origin remain loadable (production view JS/CSS are inlined and do not need the origin for script/style fetches, but the origin append stays). Public assets are same-origin with the serving origin and need no extra CSP declaration beyond that append. In **dev** (views primed with `{ dev: true }`), the registration layer also **auto-appends the serving origin's websocket variant** (`http:` → `ws:`, `https:` → `wss:`) to `csp.connectDomains` on both surfaces so Vite HMR passes host `connect-src` — derived from the same per-request origin as `resourceDomains`, never emitted in production. Vite dev's `eval` usage can violate host `script-src`; the MCP Apps CSP shape is origin-lists only and cannot declare an eval allowance, so if strict hosts block it the fix is Vite-side (e.g. jitless deps, no eval-based sourcemaps) — deferred until it bites in practice (Open questions).

### Public assets

v1 parity: authors drop static files in a project-root `public/` directory and reference them from views with root-relative paths (`/fruits/apple.png`). Two mechanisms coexist:

1. **Imported assets** — `import url from "./file.png"` in a view module. Vite inlines them as data URLs in the self-contained production bundle (`assetsInlineLimit`); in dev they resolve through Vite with absolute URLs via `server.origin`.
2. **Public folder** — files under `public/` served at `GET ${basePath}/_mcp-use/public/<path…>`. **Build** copies `public/` → `.mcp-use/build/views/public/`. **Dev** and **start** read from `<projectRoot>/public` (dev) or `.mcp-use/build/views/public/` (production). Missing `public/` → route 404s; nothing breaks. Path traversal (`..`, backslashes) is rejected (same posture as the assets route).

**Runtime resolution.** The synthesized document injects one inline `<script>` before the view module script:

```html
<script>globalThis.__mcpUseViewConfig={"publicBase":"<origin><basePath>/_mcp-use/public/"};</script>
```

`publicBase` is request-scoped (computed per request), not boot-time baked — the v1 mistake of baking origin at startup remains dead. `<Image>` reads this global (the one public consumer; the internal `publicAsset()` resolver is not exported — v1 shipped the same posture, an `<Image>` component over injected globals with no standalone resolver): root-relative `src` values resolve to `${publicBase}<path-without-leading-slash>`; absolute `http(s):` and `data:` URLs pass through; fully-relative paths (no leading `/`) are left alone. Non-`<img>` consumers (CSS backgrounds, `<video>`) can be served by exporting the resolver later — additive, deferred until asked for. `import.meta.url` relative resolution was rejected for public assets because the dev virtual entry URL (`/@id/__x00__virtual:mcp-use/views/<name>`) has no stable sibling `public/` segment — the injected config works identically in dev and production.

### Dev

`mcp-use dev` adds the client environment to the **same Vite dev server** the implemented CLI already runs (`CLI_SPEC.md`'s single process — today it runs the node/SSR environment only, with the Vite server in middleware mode), with its middleware mounted at `${basePath}/_mcp-use/` ahead of the MCP handler. When views exist, Vite `server.origin` is set to the dev server's browsable origin — `http://localhost:<port>` for loopback/wildcard binds, `http://<host>:<port>` otherwise (a wildcard bind address like `0.0.0.0` accepts connections but is not itself a valid request host in every browser) — so imported asset URLs are absolute (srcdoc iframes, Public assets).

- View documents are synthesized per request (same shell, `@vite/client` + the virtual entry served through the middleware — `kind: "external"`); assets flow through Vite transform — no build step, no manifest file. Dev documents therefore boot via Vite module fetches (HMR); catching the very start of an argument stream is best validated against a production build (self-contained inline documents). The in-memory view registry plays the manifest's role, kept current by Vite's watcher: add/remove view directories trigger the entry's existing reload-and-swap — a fresh `MCPServer`, re-primed via the internal API (Registration mechanism, above) — never mutation of a running instance; the next `tools/list`/`resources/list` reflects it. The `public/` route serves `<projectRoot>/public` directly (Public assets).
- **View-file edits get Vite HMR.** This is the client half of the one dev server: view code is pure browser code, so Vite's own HMR channel applies to it. The server entry keeps `CLI_SPEC.md`'s implemented reload-and-swap contract untouched — its reload-not-HMR rule is about the *server* module graph, and views don't change that. Because hosts enforce the resource's `ui.csp.connectDomains` against the HMR websocket, dev priming (`__primeViews(views, { dev: true })`) auto-appends the request-resolved serving origin's websocket variant to `connectDomains` on both `resources/list` and each `resources/read` content item — same origin derivation as `resourceDomains`, production never emits it (Serving, CSP consequence).
- **HMR means React Fast Refresh, not document reload.** A bare Vite setup has no HMR accept boundary in a view's module graph, so every `view.tsx` edit degrades to `full-reload` — which reloads the srcdoc iframe document and wipes all component state, bridge state, and pending tool results. Three pieces prevent that, all dev-only:
  - **`@vitejs/plugin-react` provides the refresh boundary.** It is an optional peer of this package (the `vite` pattern, `CLI_SPEC.md`). If the user's Vite config already registers it (detected by the resolved plugin name `vite:react-refresh` — a second instance would double-wrap every component module), that instance wins; otherwise `dev` resolves it from the project and injects it. A project with neither degrades to full-reload behavior with a one-line warning naming the fix — never an error, since views still work.
  - **The virtual entry imports the refresh preamble.** Fast Refresh needs its runtime hooked into the window before any component module evaluates — the job plugin-react's `transformIndexHtml` does for Vite-served HTML, which the synthesized srcdoc document never passes through. When refresh is active, each virtual entry's **first** import is the plugin's own virtual preamble module (`@vitejs/plugin-react/preamble`), so the hook is installed before react-dom or any refresh-wrapped view module runs.
  - **The virtual entry self-accepts.** Dev entries end with `import.meta.hot.accept()`, so an update that propagates past the view module (e.g. a non-component export defeating Fast Refresh's self-accept) re-runs the bootstrap — `bootstrapView` re-renders into the existing React root and the bridge singleton survives — instead of escalating to a document reload. Build entries carry neither the preamble import nor the accept call (production output stays inert).
- **Deferred:** emitting `tools/list_changed`/`resources/list_changed` to connected clients when a dev reload changes the registry. Under the stateless wire the next `tools/list` is always current, so nothing is ever stale — the notification is a nicety for long-lived clients (the inspector), and it lands with the notifications phase (`SPEC.md`), not with views.
- `view.name` → directory validation (Server API, above) runs at registration in dev and at build in prod — same check, two enforcement points.

### `start` and serverless

`mcp-use start` imports the built wrapper entry — views arrive already primed with inline JS/CSS (Registration mechanism, above) — and serves the synthesized documents plus public assets: no vite, no discovery, no cli chunk (the routes, document synthesis, and origin resolution live in the runtime package). Serverless targets get the identical code path: the function entry imports `.mcp-use/build/index.js` and `getHandler()` serves the same routes. The MCP surface needs zero filesystem; **public assets are the one remaining fs-shaped thing**, handled per platform: node/`start` reads `.mcp-use/build/views/public/` directly; Vercel functions have a real fs and need only file tracing (one `vercel.json` `includeFiles` line — the views variant of `examples/vercel` ships it); Cloudflare Workers use Workers Static Assets on the public route (or the `nodejs_compat` `/bundle` VFS via module rules). And the escape hatch works everywhere: the origin override + any CDN/static host in front of `${basePath}/_mcp-use/public/` works unmodified.

---

## Typing: `ToolRef` + `Register` (zero codegen)

Exports-based inference is the primary mode; typegen is an explicit escape hatch only, never on the dev/build hot path. The full option space behind this choice (including the rejected alternatives) is preserved in `type_proposals.md`.

### `tool()` return-type change

`tool()` returns `ToolRef<Name, Input, Output>` instead of `this` — a value (`{ name }` at runtime) carrying phantom types read off the existing `InferToolInput`/`InferToolOutput` machinery in `src/tools.ts`. Standard Schema does the inference, so typed views work with zod v4, ArkType, and Valibot alike. Requires a `const` type parameter (`tool<const T extends ToolDefinition>`) so `name` infers as a literal.

This ends `server.tool(…).tool(…)` chaining — an acceptable break: nothing in the repo chains today, chaining without type accumulation is convenience only, type accumulation remains off the table (`SPEC.md` ground rule — `MCPServer` stays non-generic; `resource()`/`prompt()` keep returning `this` until a consumer needs refs), and the official v2 SDK itself returns a handle from `registerTool`.

### How types reach view files

View bundles must never contain server code, so the ref **value** is never imported by a view. The type crosses in type space only:

```ts
// src/register.d.ts — scaffolded once, committed, never regenerated
// (the vite-env.d.ts pattern: configuration, not codegen — it lives in the
// source tree because .mcp-use/ is gitignored and rm -rf-safe, CLI_SPEC.md)
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}
```

```ts
// in /react
export interface Register {}  // filled (or not) by the project's register.d.ts

type RegisteredToolsModule = Register extends { tools: infer M } ? M : Record<never, never>;

type ToolsFromModule<M> = {
  [K in keyof M as M[K] extends ToolRef<infer N, any, any> ? N : never]:
    M[K] extends ToolRef<any, infer I, infer O> ? { input: I; output: O } : never;
};

type RegisteredTools = ToolsFromModule<RegisteredToolsModule>;
```

Users export the refs of tools views care about (`export const searchFruits = server.tool(…)`) — the module is the registry; no map API, no `export type AppType` ritual, no user-written `declare module`. The name union covers **every exported ref** regardless of `visibility` (a view may call model-visible tools too; `visibility: "app"` declares app-only visibility — the host hides the tool from the model per `_meta.ui.visibility`, not the server). `typeof import()` is a live tsserver edge: add a tool, and every view's `useCallTool` union updates with no process running. Multi-file registration composes via re-exports (`export * from "./tools/fruits.js"`).

`ToolContextHandle` resolves through the same map. The type parameter is the set of tools that may deliver results to this view — a single name or a union for multi-binder views. The ready branch **distributes** over the union so narrowing `toolName` narrows `toolOutput`:

```ts
type ToolContextHandle<Name extends keyof RegisteredTools> =
  | {
      status: "pending";
      toolName: Name | undefined; // last known calling tool (hostContext.toolInfo seed); informational — input notifications carry no tool identity
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason?: undefined;
    }
  | {
      status: "streaming";
      toolName: Name | undefined;
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason?: undefined;
    }
  | {
      status: "cancelled";
      toolName: Name | undefined;
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason: string | undefined;
    }
  | {
      [N in Name]: {
        status: "ready";
        toolName: N; // authoritative — from result `_meta["mcp-use/toolName"]`
        toolInput: RegisteredTools[N]["input"] | undefined;
        toolOutput: RegisteredTools[N]["output"];
        content: ContentBlock[] | undefined;
        meta: Record<string, unknown> | undefined;
        reason?: undefined;
      };
    }[Name];
```

`useToolContext<Name>()` returns this handle. TypeScript narrowing on `status === "ready"` guarantees complete, typed `toolOutput`; narrowing further on `toolName` (when `Name` is a union) selects that binder's output type. `toolInput` is the single streaming field: partials from `ui/notifications/tool-input-partial` and the complete args from `ui/notifications/tool-input` write the same field (last write wins); during `"streaming"` / `"cancelled"` it is typed `DeepPartial<Input>`.

Canonical multi-binder pattern:

```tsx
const view = useToolContext<"draw" | "refresh-canvas">();
if (view.status === "ready" && view.toolName === "draw") {
  // view.toolOutput is draw's output type
}
```

Single-binder usage is unchanged apart from the extra `toolName` field.

Keying by tool name (not view directory name) is deliberate: view names exist only in the filesystem/manifest, which type space cannot see without codegen — tool names exist as literal types on exported refs. The type parameter is the author's declaration of which tools may deliver results to this view; a union covers multi-binder views, and `toolName` narrows the ready branch. It is not enforced in type space (a wrong literal compiles against the wrong schema); the runtime binding checks at mount/build (decision 10) are the enforcement. Unbound views (inspector-preview only) never reach `"ready"` — components branch on hook state and declare no required result payload.

**Note for cutover:** the `declare module` specifier must match the published import path — it becomes `"mcp-use/react"` when the package renames. The scaffolded file is the only thing that changes.

### Fallback ladder

1. `useCallTool("name")` — primary; typed via `Register` when the project has `register.d.ts` and the ref is exported.
2. `useCallTool(toolRef)` — for contexts where the ref value is legitimately in scope (the inline-JSX stretch path); not for file-based views (value import = server code in the bundle).
3. `useCallTool<Args, Result>("name")` — explicit generics for dynamically registered tools (statically untypeable in any framework) and unexported refs.
4. Empty `Register` (no `register.d.ts`) degrades to `(name: string)` — non-scaffolded projects compile untouched.

A forgotten `export const` silently drops that one tool to rung 3/4 — documented habit; a lint rule is a possible follow-up, not alpha scope.

### Typegen, demoted

Nothing generates types during `dev`, `build`, or `start` — v1's run-the-server generator (`tool-registry-generator.ts`, `zod-to-ts.ts`) is not ported, and the implemented CLI has no typegen hooks to remove. `mcp-use typegen` (+ `mcp-use check` for CI freshness) is the explicit secondary mode, for consumers with no compile-time path to the server source; if/when built, it is a TS-checker-based static extractor (reads resolved `ToolRef` types; never executes user code), defaulting output to `.mcp-use/generated/`. Not an alpha deliverable.

Since v2 `create-mcp-use-app` templates don't exist yet, the handwritten example in this package (planned `examples/views/basic`) is the reference for the `register.d.ts` + exported-refs pattern.

---

## React runtime (`/react` subpath)

`@mcp-use/server/react` (→ `mcp-use/react` at cutover). Browser-only code built on the ext-apps guest `App` (one instance per iframe, connected once via `PostMessageTransport`); `react` and `react-dom` are optional peers; importing the subpath from server code is unsupported. The v1 hook *surface* is kept (renamed); the v1 transport guts (three-provider selection, `window.openai` branch, hand-rolled `McpAppsBridge`) are not.

### Component lifecycle & view data

The generated iframe entry — not user code — connects the bridge and mounts the default export once; the component stays mounted for the iframe lifetime. No props are spread onto it.

**Mount timing.** The default export renders as soon as the bridge connects — before any tool result — and remains mounted through streaming, result delivery, and subsequent re-renders. There is no separate loading component export and no component swap; the pre-result window is handled inside the component by branching on `useToolContext<Name>()` state. State continuity across streaming → ready is inherent — the same component instance owns DOM and React state throughout.

**Primary data hook: `useToolContext<Name>()`.** Returns a discriminated union `ToolContextHandle<Name>`:

- **`status: "pending" | "streaming" | "cancelled" | "ready"`** is the discriminant.
- **`"pending"`:** no result yet and arguments are not mid-stream. Covers both "nothing arrived" and "complete input received, awaiting result" — `toolInput` is the complete args when delivered (`Input | undefined`).
- **`"streaming"`:** partial args are arriving; `toolInput` grows progressively and is typed `DeepPartial<Input>` (provisional, render-only — strings may be truncated mid-token).
- **`"cancelled"`:** host sent `ui/notifications/tool-cancelled` (host MUST send on any cancellation — user action, sampling error, classifier intervention). `reason` is the optional spec-provided string. `toolInput` may be partial (cancelled mid-stream) — typed `DeepPartial<Input>`.
- **`"ready"`:** result arrived; `toolName` is authoritative (from result `_meta["mcp-use/toolName"]`); `toolOutput` = that tool's output type (from `outputSchema`, via `Register`/`RegisteredTools`); `content` = result `content` blocks; `meta` available (the view-only result channel); `toolInput` is the complete args when delivered.
- **`toolName`:** on `"pending"` / `"streaming"` / `"cancelled"`, `Name | undefined` — last known calling tool, seeded from `hostContext.toolInfo` when the host provides it (informational only; input notifications carry no tool identity). On `"ready"`, the result stamp is authoritative and the ready branch distributes over the name union so `toolName === "draw"` narrows `toolOutput` to that tool's output type.

TypeScript narrowing on `status === "ready"` guarantees complete `toolOutput`; narrowing on `toolName` (multi-binder unions) selects the binder's output type — this replaces the old guarantee that a component signature implied complete result data.

**Status transitions.** `status` is derived from the bridge notifications, checked in order:

- `"ready"` iff a tool result has arrived for the current call cycle (`ui/notifications/tool-result`; `hasToolResult`). A result also clears any prior cancellation and sets `toolName` from `_meta["mcp-use/toolName"]`. Later results keep it `"ready"` with updated `toolName`, `toolOutput`, `content`, and `meta`.
- Otherwise `"cancelled"` iff the host sent `ui/notifications/tool-cancelled` for the current call cycle.
- Otherwise `"streaming"` iff arguments are streaming — set by `ui/notifications/tool-input-partial`. A complete `ui/notifications/tool-input` ends the streaming phase (status returns to `"pending"` while awaiting the result). A call whose host sends no partial notifications stays `"pending"` until `"ready"` (or `"cancelled"`).
- Otherwise `"pending"`.

A new call cycle resets cancellation and stale result state so a reused iframe can leave `"cancelled"` / `"ready"`: every `tool-input-partial` clears `cancelled` and result state (status becomes `"streaming"`); a complete `tool-input` always clears `cancelled`, and clears result state only when a prior result already exists (that input belongs to a subsequent call — within a single call, `tool-input` precedes `tool-result`, so the mid-cycle pending path is unchanged). A `tool-cancelled` after a second call's input surfaces `"cancelled"` again.

Canonical authoring pattern:

```tsx
export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();
  if (view.status !== "ready") {
    return <SearchSkeleton query={view.toolInput?.query} pulsing={view.status === "streaming"} />;
  }
  return <ResultsGrid items={view.toolOutput.items} />;
}
```

**Result delivery.** Later tool results transition the handle to `"ready"` with new `toolOutput` — ordinary React update semantics on the same mounted component, nothing bespoke. The payload is exactly `structuredContent` — no v1-style merge of `toolInput` into tool output (that merge conflated two channels with different types and timing).

**Unbound views** (warned at mount — decision 10) mount and run hooks but never reach `"ready"` if nothing delivers a tool result (inspector preview); such components branch on hook state and don't assume result payload.

Components compose the split hooks they need — no aggregate; rerender isolation by design.

### Streaming

Two distinct things can stream, and only one of them exists on the wire today:

**1. Tool *arguments* stream — supported** (spec: `ui/notifications/tool-input-partial`). Hosts deliver progressively parsed arguments while the model is still generating the call — the pre-result window. Partials fire 0..n times strictly before the single complete `ui/notifications/tool-input`. The always-mounted component reads this through `useToolContext<Name>()` — both partial and complete args write the same `toolInput` field (last write wins):

```tsx
export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();
  if (view.status !== "ready") {
    return <SearchSkeleton query={view.toolInput?.query} pulsing={view.status === "streaming"} />;
  }
  return <ResultsGrid query={view.toolOutput.query} items={view.toolOutput.items} />;
}
```

During `"streaming"`, `toolInput` is `DeepPartial<Input>` — deep-partial because streamed JSON is incomplete by nature (objects missing fields, string values possibly truncated mid-token: treat as provisional, render-only, never act on them). Once `ui/notifications/tool-input` arrives, streaming ends and `toolInput` carries the complete arguments on `"pending"` (awaiting result) and `"ready"`. The deliberate type-source split: `toolInput` types from the tool's `inputSchema` (input); `toolOutput` from its `outputSchema` — both read off the same `ToolRef`.

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
  return <Canvas elements={elements} streaming={view.status === "streaming"} />;
}
```

Schema guidance that falls out: **declare streamable payloads as structured schema, not JSON-in-a-string.** Hosts heal the *outer* argument JSON, so a `z.array(...)` field arrives as a partial array of typed elements; a stringified payload arrives truncated mid-token and the view must re-heal it by hand (the shipped Excalidraw app pays exactly that cost). Because the component never unmounts across streaming → ready, DOM and React state built during streaming survive the transition — no separate continuity mechanism is required.

**2. Tool *results* do not stream — wire fact, honest alpha posture.** The 2026-07-28 protocol and the apps spec deliver exactly one `ui/notifications/tool-result` per call: there is no partial-`structuredContent` channel, so progressive handler-side results (generator-style callbacks yielding progressive output) is not expressible and is **not** faked in the framework (no polling/chunking shims). Progressive UIs *pull* instead: the view calls tools via `useCallTool` and owns that state locally (those results return to the caller; they do not become new `toolOutput`). If the protocol later grows partial tool results, they map onto `toolOutput` as ordinary re-renders — same channel, more deliveries, no API change; tracked in Open questions.

### View tools (`useViewTool`)

The apps spec lets the *view* expose tools the **host/model** calls while the view is displayed (ext-apps `App.registerTool` → `RegisteredAppTool`, WebMCP-style; Linear MCP-2309). This is the third tool flavor — keep the taxonomy straight:

| Flavor | Registered by | Called by | Lifetime |
| --- | --- | --- | --- |
| server tool | `server.tool()` | model (via host) | server process |
| server tool, app-visible | `server.tool({ view: { visibility: "app" } })` | the view, via `useCallTool` | server process; host hides from the model per `_meta.ui.visibility` |
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

- **React lifecycle = tool lifecycle.** Register on mount keyed by `name`, `remove()` on unmount, `update()` in place when `title`/`description`/`annotations` change, `enabled: false` → `disable()` without unmounting (a disabled tool stays registered but is not listed/callable); ext-apps emits `tools/list_changed` automatically, so the host's tool list always matches the mounted UI (strict-mode double-mount is safe: remove + re-register). `inputSchema`/`outputSchema` are captured at registration time — inline `z.object(...)` literals in the definition never re-register the tool per render (ext-apps fixes the handler's arity at registration anyway); changing a tool's schema means registering under a new name. `schema` is accepted as an alias for `inputSchema`.
- **Latest-closure handler:** the registered callback delegates through a per-render ref (`useEffectEvent` pattern) — handlers always see current state, no re-registration per render.
- **Connect-time capability:** ext-apps only auto-advertises the `tools` capability for pre-connect registrations, and hooks run post-connect — so the generated iframe entry always declares `tools: { listChanged: true }`. Harmless for views with no tools (empty list).
- **Not in `Register`:** view tools never appear on the server's `tools/list` and are never callable from views — typing them into `useCallTool` would advertise calls nobody can make. Their input/output types live and die inside the component.
- **Progressive enhancement only:** no host capability promises app-tool support; hosts that support it list/call, others ignore. Registration is unconditional and cheap; views must not depend on view tools being invoked.
- **Channel note:** a view tool's result (`content`/`structuredContent`) flows host→model — the second explicit view→model channel (alongside `ui/message`), distinguished by being *model-initiated*.

### `/react` API reference

The complete alpha surface. Everything here is exported from `@mcp-use/server/react`; types marked *vendored* alias the ext-apps `spec.types.ts` definitions (carried with attribution, per the dependency posture).

**Types.**

```ts
/** Augmented by the project's register.d.ts; empty by default. */
interface Register {}

/** Discriminated union returned by useToolContext<Name>(). */
type ToolContextHandle<Name extends keyof RegisteredTools> =
  | {
      status: "pending";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason?: undefined;
    }
  | {
      status: "streaming";
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason?: undefined;
    }
  | {
      status: "cancelled";
      toolInput: DeepPartial<RegisteredTools[Name]["input"]> | undefined;
      toolOutput: undefined;
      content: undefined;
      meta: undefined;
      reason: string | undefined;
    }
  | {
      status: "ready";
      toolInput: RegisteredTools[Name]["input"] | undefined;
      toolOutput: RegisteredTools[Name]["output"];
      content: ContentBlock[] | undefined;
      meta: Record<string, unknown> | undefined;
      reason?: undefined;
    };

/** Recursive partial for streamed JSON: every field optional at every depth.
 *  Arrays may be shorter than final; string values may be truncated mid-token.
 *  Provisional, render-only data — never act on it. */
type DeepPartial<T> = T extends (infer E)[]
  ? DeepPartial<E>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
```

**`useToolContext<Name>()`** — primary data hook. Returns `ToolContextHandle<Name>` (Component lifecycle & view data). Narrow on `status === "ready"` for typed `toolOutput`.

```ts
function useToolContext<Name extends keyof RegisteredTools>(): ToolContextHandle<Name>;
```

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

**Action hooks** — one hook per concern; stable function identities.

```ts
function useCallTool<Name extends keyof RegisteredTools>(name: Name):
  CallToolHandle<RegisteredTools[Name]["input"], RegisteredTools[Name]["output"]>;
function useCallTool<R extends ToolRef<string, unknown, unknown>>(ref: R): /* same, from the ref */;
function useCallTool<Args extends Record<string, unknown>, Result = unknown>(name: string):
  CallToolHandle<Args, Result>;

interface CallToolHandle<Args, Result> {
  callTool: (args: Args) => Promise<CallToolResult & { structuredContent: Result }>;
  data: (CallToolResult & { structuredContent: Result }) | undefined; // last successful result
  error: Error | undefined;   // last failure (reset on next call)
  isPending: boolean;         // a call is in flight
}

function useSendFollowUp(): (args: { prompt: string }) => Promise<void>;  // ui/message — triggers a model turn
function useOpenExternal(): (args: { url: string }) => void;            // App.openLink
function useSendSizeChanged(): (size: {
  width?: number;
  height?: number;
}) => Promise<void>;                                                    // App.sendSizeChanged — ui/notifications/size-changed
function useDisplayMode(): {
  displayMode: "inline" | "fullscreen" | "pip";
  requestDisplayMode: (args: { mode: "inline" | "fullscreen" | "pip" }) => Promise<void>;
};
```

**`requestDisplayMode` resolves `void` by design** — the underlying `App.requestDisplayMode` returns the granted mode, but surfacing it would create a second source of truth that invites stashing the mode in state, where it goes stale the moment the host changes modes on its own (user exits fullscreen, mobile reflow). The hook's `displayMode` subscription is the single source of truth for the outcome; a denied request simply leaves it unchanged.

**`useSendSizeChanged()`** — manual size reporting for the host iframe. Auto-resize is on by default (ext-apps measures the document under `height: max-content` and sends `ui/notifications/size-changed`). Views whose height derives from their width — for example a fixed aspect-ratio container sized via `ResizeObserver` — measure ~0 under that strategy and the host collapses the iframe. Export `viewOptions: { autoResize: false }` from `view.tsx` to opt out, then call `useSendSizeChanged()` with `{ width, height }` from a container observer (or equivalent).

**`useViewTool(definition, handler)`** — view-registered tools (contract above). `definition` mirrors `ToolDefinition` plus `enabled?: boolean`; the handler's params/return are inferred exactly like a server tool's.

**Local UI state is plain React `useState`** — there is deliberately no `useViewState` wrapper. MCP Apps has no host-persisted view store (see "Dropped from v1"), so a dedicated hook would only restate `useState` while implying persistence that does not exist. Making state visible to the model is likewise deferred: the alpha exposes no `ui/update-model-context` API (see "Dropped from v1").

**`useViewTheme(): "light" | "dark"`** — narrow theme-only subscription; rerenders only on host theme changes.

**Providers and components.** The generated iframe entry owns the essentials itself — bridge connection, always-mounted default export, auto-resize (on by default; per-view opt-out via the `viewOptions` named export, with manual reporting via `useSendSizeChanged`), a top-level error boundary — so **no provider is required**. `<McpUseProvider>` remains as the opt-in wrapper bundling theme application + error-boundary customization; `<ThemeProvider>` applies host style variables/fonts (ext-apps `applyDocumentTheme`/`applyHostStyleVariables`/`applyHostFonts`); `<ViewControls>` is the dev-only overlay (v1's `WidgetControls`, renamed); `<ErrorBoundary>` is carried unchanged; `<Image>` resolves root-relative `src` paths against the request-scoped `__mcpUseViewConfig.publicBase` injected into the synthesized document (Public assets).

### Putting it together — a complete view

Reference sketch exercising the full surface (the `examples/views/basic` example follows this shape). Server side, the running example plus one more exported tool:

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
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useToolContext,
  useViewTool,
} from "@mcp-use/server/react";

export default function ProductSearchResult() {
  const view = useToolContext<"search-fruits">();
  const { theme } = useHostContext();
  const { displayMode, requestDisplayMode } = useDisplayMode();
  const sendFollowUpMessage = useSendFollowUp();
  const openExternal = useOpenExternal();

  // local UI state (iframe lifetime; not model-visible, not host-persisted)
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // server tool call from the view — name union + args/result typed via Register
  const details = useCallTool("get-fruit-details");

  // view tool — the model can manipulate this UI while it is on screen
  useViewTool(
    { name: "highlight-fruit", description: "Highlight a visible result", inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => {
      setSelected(id);
      return { content: [{ type: "text", text: `Highlighted ${id}` }] };
    }
  );

  if (view.status !== "ready") {
    return (
      <SearchSkeleton
        query={view.toolInput?.query}
        pulsing={view.status === "streaming"}
      />
    );
  }

  const { query, items } = view.toolOutput;

  return (
    <div data-theme={theme}>
      <ResultsGrid
        items={items}
        selected={selected}
        onFavorite={(id) => setFavorites([...favorites, id])}
        onDetails={(fruit) => details.callTool({ fruit })}   // typed args
        onOpenProducer={(url) => openExternal({ url })}
      />

      {details.isPending && <Spinner />}
      {details.data && <DetailsCard data={details.data.structuredContent} />} {/* typed via Register */}

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

Everything result-shaped enters through `useToolContext` (typed by the server's `outputSchema`; `query` is there because the handler echoes it for model visibility); everything ambient or imperative goes through split hooks; the view→model paths (`sendFollowUpMessage`, view-tool results) are explicit, never ambient. For tools not in the `Register` (dynamic registration, unexported refs), the explicit-generics rung applies with hand-written types: `useCallTool<{ fruit: string }, { name: string; producer: string }>("get-fruit-details")`.

### Hook surface (v1 → v2 → backing primitive)

| v1                                                                                                      | v2                                                                                        | Backed by                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useWidget()`                                                                                           | split hooks (no aggregate)                                                                | `App` events + `getHostContext()`                                            |
| — `props` / `toolInput` / `output`                                                                      | `useToolContext()` primary (`status` discriminant; `output` folds into `toolOutput`; args stream into `toolInput`) | `ontoolinput` / `ontoolinputpartial` / `ontoolresult`                        |
| — `metadata`                                                                                            | `meta` on `useToolContext` when `ready` — view-only result channel                        | result `_meta` from `ontoolresult`                                           |
| — `partialToolInput` / `isStreaming`                                                                    | `toolInput` on `useToolContext` (`streaming` branch; last write wins)                     | `ontoolinputpartial` / `ontoolinput`                                         |
| — `isPending`                                                                                           | `useToolContext().status === "pending"` (or `!== "ready"` for any pre-result)             | input-received-but-no-result / pre-result state                              |
| *(no v1 equivalent)*                                                                                    | `useToolContext().status === "cancelled"` + `reason`                                      | `ontoolcancelled`                                                            |
| — `theme` / `locale` / … / `isAvailable`                                                                | `useHostContext()`; `useViewTheme()` for theme-only                                       | `hostContext` + `onhostcontextchanged`                                       |
| — `callTool`                                                                                            | `useCallTool()` (typed; preferred)                                                        | `App.callServerTool`                                                         |
| — `sendFollowUpMessage`                                                                                 | `useSendFollowUp()`                                                                       | `App.sendMessage` (`ui/message`)                                             |
| — `openExternal`                                                                                        | `useOpenExternal()`                                                                       | `App.openLink`                                                               |
| — `requestDisplayMode` / `displayMode`                                                                  | `useDisplayMode()` → `{ displayMode, requestDisplayMode }`                                | `App.requestDisplayMode` + `hostContext`                                     |
| *(no v1 equivalent / auto-size)*                                                                        | `viewOptions.autoResize` (default `true`) + `useSendSizeChanged()`                        | `App` `autoResize` option + `App.sendSizeChanged`                            |
| `useWidgetProps()`                                                                                      | `useToolContext()` — primary data API                                                       | bridge notifications → discriminated union                                   |
| `useWidgetState()`                                                                                      | dropped — plain `useState` for local UI state; model visibility deferred                  | no host store in MCP Apps — see "Dropped from v1"                            |
| `useWidgetTheme()`                                                                                      | `useViewTheme()`                                                                          | dedicated `hostcontextchanged` subscription                                  |
| `useCallTool(name \| ref)`                                                                              | kept, typed via `Register`/`ToolRef`                                                      | `App.callServerTool`                                                         |
| *(no v1 equivalent)*                                                                                    | `useViewTool()` — view-registered tools the host/model calls (see View tools)             | `App.registerTool` + `tools/list_changed`                                    |
| `<McpUseProvider>`                                                                                      | kept (optional — the generated entry covers the essentials)                               | auto-resize via `App`'s built-in `autoResize` (default on; opt out with `viewOptions`); theme; error boundary |
| `<ThemeProvider>`                                                                                       | kept                                                                                      | ext-apps `applyDocumentTheme` / `applyHostStyleVariables` / `applyHostFonts` |
| `<WidgetControls>`                                                                                      | `<ViewControls>`                                                                          | dev-only overlay, ported                                                     |
| `<ModelContext>` / `modelContext`                                                                       | deferred — no model-context API in the alpha (see "Dropped from v1")                      | `App.updateModelContext` (`ui/update-model-context`)                         |
| `<ErrorBoundary>`                                                                                       | kept                                                                                      | unchanged                                                                    |
| `<Image>`                                                                                               | kept — resolves root-relative `src` via `__mcpUseViewConfig.publicBase` (Public assets)   | `<img>` with absolute URL                                                    |
| `generateHelpers()`                                                                                     | dropped                                                                                   | subsumed by `Register` typing                                                |

### Dropped from v1 (spec gaps)

- **`useFiles()` (upload):** file upload does not exist in MCP Apps (upstream: "not yet implemented"); it is a ChatGPT-only `window.openai` extension. Dropped from the alpha; host-mediated *download* (`ui/download-file`, draft) may land later.
- **Cross-session view state:** `window.openai.setWidgetState`'s host-persisted-and-restored state has no spec equivalent, so there is no state hook at all — local UI state is plain React `useState` (iframe lifetime), and a `useViewState` wrapper would only restate it while implying a host store that does not exist.
- **Model context (`ui/update-model-context`):** deferred — no runtime API in the alpha. The wire method exists (ext-apps `App.updateModelContext`), but the SDK surface for it is a state-management design question — what state the model should see, when it updates, and how it composes with local UI state — and it will be decided as one piece rather than shipped as a standalone push API. v1's conflation of "UI state" and "model context" in one `setWidgetState` is deliberately split; the model-context half lands with that design.
- **`_meta.openai/*` emission** (`outputTemplate`, `widgetCSP`, invocation strings, …): overlay territory, out of the alpha (see Protocol posture).

---

## CLI integration

The full build/serve contract is "Build system & serving", above; it extends the **implemented** `CLI_SPEC.md` (which scoped views out) and its ground rules hold — reload-not-HMR for the server entry, `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk. Command summary:

- **`mcp-use dev`:** adds the Vite client environment to the existing dev server; view documents/assets serve through its middleware at `${basePath}/_mcp-use/`. View-file edits get Vite's own HMR (pure client code, sharing the one Vite dev server); server-entry edits follow the existing reload contract. `list_changed` emission on reload stays deferred (decision 12). No typegen hooks anywhere.
- **`mcp-use build`:** one client-environment build over all views into `.mcp-use/build/views/`; writes the manifest `views` map (tooling copy) and bakes it into the generated wrapper entry (runtime copy — Registration mechanism); runs the binding checks (missing view, missing `outputSchema`, two facts-declaring binders for one view → errors naming both tools; unbound view → warning).
- **`mcp-use start`:** imports the built wrapper entry (views arrive primed) and serves prebuilt assets; no vite, no discovery, no runtime manifest read.

## Testing

- **Type-level** (`tests/type-level.test.ts` pattern): `ToolRef` name/input/output inference incl. non-zod Standard Schema libs; `ToolsFromModule` filtering and re-export composition; `useCallTool` name union + arg/result types; empty-`Register` fallback; `structuredContent` vs `outputSchema` agreement at the return position; `useToolContext` discriminated union narrowing (`status === "ready"` → typed `toolOutput`; multi-binder `toolName` narrows `toolOutput`; `"streaming"` / `"cancelled"` → `DeepPartial` `toolInput`; `"cancelled"` → `reason`); input-schema vs output-schema type-source split (`toolInput` vs `toolOutput`); `DeepPartial` over arrays/nested objects.
- **e2e over HTTP** (official client): view resource listing/reading with correct mimetype and framework auto-CSP in `_meta.ui.*` on both `resources/list` entries and `resources/read` content items for all clients; `tools/list` includes every registered tool for all clients (including `visibility: "app"` tools with `_meta.ui.visibility: ["app"]`); `ui.visibility` emitted only when top-level `visibility` is set (any tool); **channel separation** — handler `{ structuredContent, content, _meta }` lands on the wire as `structuredContent` / `content` / `_meta` respectively, with handler `_meta` absent from everything model-facing; `_meta.ui.resourceUri` and `_meta["mcp-use/toolName"]` auto-stamped on every non-error view-bound tool result.
- **Build/serve** (CLI-test pattern from `tests/cli/`, real `build` against a views fixture): manifest `views` map shape (`entry`, `css` only); the built wrapper entry primes registration with zero `fs` on the MCP path (list/read succeed with the built assets dir absent; only asset routes 404); document + asset routes under `${basePath}/_mcp-use/` with correct cache headers; the manifest→URL→disk basename mapping; per-request origin resolution (proxy headers, override) reflected in both the HTTP document and the `resources/read` body and content-item `_meta.ui.csp.resourceDomains`; asset origin auto-appended to `csp.resourceDomains`; the binding checks — `view.name` naming a missing view, a `view:` tool without `outputSchema`, and two facts-declaring binders for one view fail loudly naming both tools, a view directory no tool binds warns (build still succeeds, view still registered); many tools may bind one view when only one declares facts.
- **Bridge-level:** a minimal `AppBridge` (ext-apps host class, devDep) driving a built view — initialize handshake; default export mounted on connect before any notification; `tool-input-partial` sequence driving `useToolContext().status === "streaming"` with progressive `toolInput` on the same mounted component; complete `tool-input` returning to `"pending"` then `tool-result` transitioning to `status === "ready"` with typed `toolOutput` and `content` (no component swap); mid-stream `tool-cancelled` → `"cancelled"` with optional `reason` and last partial still in `toolInput`; post-cancel retry — a new `tool-input-partial` after cancel returns to `"streaming"` (not stuck `"cancelled"`), then result → `"ready"`; post-ready second call — a new `tool-input` (or partial) after a delivered result leaves `"ready"` into `"pending"`/`"streaming"`, a subsequent result lands `"ready"` with the new payload, and a `tool-cancelled` after the second call's input surfaces `"cancelled"`; `tools/call` round-trip through `useCallTool` (`data`/`error`/`isPending` transitions); handler `meta` surfaced on `useToolContext()` when ready; split-hook channel isolation (environment/action subscriptions rerender independently of data — `useHostContext` / `useDisplayMode` do not re-render on `tool-input-partial`, still re-render on host-context change and when `isConnected` flips); **view tools** — `bridge.listTools()` reflects mounted `useViewTool`s, call round-trip mutates component state, unmount/`enabled: false` emits `list_changed` and removes/disables, re-renders with inline schema literals emit no re-registration or `list_changed` churn; **size / auto-resize** — `useSendSizeChanged` delivers `ui/notifications/size-changed` with the given `{ width, height }` (observable on the host `sizechange` / `onsizechange`); `viewOptions: { autoResize: false }` constructs the guest `App` without auto-resize so connect does not emit a size-changed notification, while the default keeps `autoResize: true`.

## Deltas vs v1 (for the migration guide)

1. Every `widget` name → `view` (`widget:` config, `useWidget*`, `WidgetControls`, `ui://widget/…` → `ui://views/…`). The v1 `widget()` response helper is dropped — handlers return plain `CallToolResult`.
2. `useWidgetProps()` → `useToolContext()` as the primary data API (`ToolContextHandle` four-status discriminated union, `toolOutput` not `props`; partial and complete args share `toolInput`); `useWidget()` → the split hooks (`useToolContext()` for data, `useHostContext()` for ambient host context, per-action hooks for bridge actions). Components mount once on bridge connect and branch on hook state — no props spread, no separate loading component export. Result payload is `structuredContent` only — v1's `toolInput` merge is gone (read input via `useToolContext().toolInput`, or echo input fields into the output schema for model visibility).
3. `widgetMetadata` export dropped — view files default-export the component, plus an optional `viewOptions` named export for guest-runtime options (currently `autoResize`). Result types come from `outputSchema` via `useToolContext<Name>()` (required on view-bound tools). Resource facts (description, CSP, permissions, domain, prefersBorder) are declared on at most one binder's `view:` config (additional binders write `view: { name }` only) and emitted on the resource — `viewOptions` is never wire metadata.
4. In-component `isPending` skeleton branching → `useToolContext()` status branching (`pending` / `streaming` / `cancelled` / `ready`) inside the always-mounted default export.
5. `useCallTool` types come from exporting tool refs, not from generated `.mcp-use/generated/tool-registry.d.ts`; template `postinstall`/dev-loop typegen is gone.
6. `useWidgetState` has no replacement hook — hold local UI state with React's `useState` (iframe lifetime only); a model-visibility API is deferred (see "Dropped from v1").
7. `useFiles` removed (ChatGPT-only capability).
8. `window.openai` is never consumed by the runtime; ChatGPT works through its native MCP Apps support.
9. Tool config `invoking`/`invoked`/`widgetAccessible` removed (openai overlay, no spec equivalent; `visibility` covers app/model narrowing).
10. Views work against the stateless 2026-07-28 wire; nothing view-related depends on sessions.
11. Asset routes move from `${basePath}/mcp-use/widgets/…` to `${basePath}/_mcp-use/…`; build output from `.mcp-use/build/resources/widgets/<name>/` to one self-contained client build per view whose JS/CSS are inlined into the synthesized document (no shared chunks across views). Boot-time origin baking and the v1 `window.__getFile`/`__mcpServerUrl` globals are gone — origin resolves per request (forwarded headers, plus an override whose shape — `publicUrl` config vs v1's `MCP_URL` — is pending, see Open questions); `assetPrefix` has no v2 equivalent (a CDN fronts the public-asset route instead). One request-scoped `globalThis.__mcpUseViewConfig` (public asset base only) is injected into the synthesized document — not boot-time baked like v1's `__mcpPublicAssetsUrl`.
12. Registration no longer happens inside `listen()`/`getHandler()` (v1's async `mountWidgets` → `server.uiResource()`): the build primes the instance through a generated wrapper entry, and `resources/read` synthesizes the document from manifest data instead of re-reading built HTML from disk on every read. `server.uiResource()` has no v2 equivalent, and neither do v1's `exposeAsTool` / hand-built `uiResource` registrations — any number of tools may bind one view via `view: { name }` (at most one facts-declaring binder), and an unbound view warns (decision 10).
13. Ambient hooks split by concern: `useHostContext()`, `useSendFollowUp()`, `useOpenExternal()`, `useDisplayMode()`, `useSendSizeChanged()` — split-by-concern is the design; each hook rerenders only on its channel (action hooks return stable callbacks).

## Open questions

- Stable `ui://views/<name>.html` vs content-hashed URIs: revisit only with evidence that a target host over-caches by URI (v1's `buildId` existed for ChatGPT; ChatGPT's MCP Apps path may not need it). External evidence: Skybridge appends `?v=<content-hash>` to view URIs in production — a second framework independently concluding hosts over-cache by URI. Expectation is this resolves toward a manifest-driven hash suffix once tested against ChatGPT; still deferred to that test, not decided here.
- **Origin override: `MCP_URL` vs `publicUrl`.** The request-scoped resolution order is decided (override → forwarded headers → request URL, applied at emission time); the override's surface is not — v1 shipped `MCP_URL` as an environment variable, and what of its v1 role carries into v2 deserves its own discussion. Until then this spec names it only "the override".
- `ui/download-file` (draft) exposure — as a standalone hook — once a target host ships it.
- Partial/streamed **tool results**: not in the 2026-07-28 protocol or the apps spec today (see Streaming). When a partial-result channel lands upstream, deliver it as ordinary `useToolContext` re-renders; until then, progressive UIs pull via `useCallTool`.
- **Vite dev `script-src` / eval:** Vite HMR and some dev transforms use `eval`, which strict host `script-src` policies may block. The MCP Apps CSP shape is origin-lists only — no `'unsafe-eval'` or nonce slot — so this cannot be declared in `view.csp`. If it bites in practice, the fix is Vite-side (jitless deps, no eval-based sourcemaps); dev already auto-appends the HMR websocket origin to `connectDomains` (Serving).
- Sampling from views (`createSamplingMessage`, draft) — post-alpha, follows the server package's sampling posture (`SPEC.md`, elicitation & context phase).
- Overlay mechanism shape (if a host demands `openai/*` keys): registration-boundary transform, opt-in per server or per host detection — design when needed.
