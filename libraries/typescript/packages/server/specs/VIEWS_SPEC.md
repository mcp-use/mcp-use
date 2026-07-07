# @mcp-use/server — Views (MCP Apps) spec

**Status:** design contract, pre-implementation. Companion to `SPEC.md` (whose views phase points here) and `CLI_SPEC.md` (the implemented `dev`/`build`/`start` base contract this document extends).
**Scope:** the views runtime in the server package, view resources and protocol metadata, the React view runtime (`/react` subpath), the zero-codegen typing layer (`ToolRef` / `Register`), and the views half of the `dev`/`build`/`start` contract.
**Tracking:** Linear MCP-2601 (Views & MCP Apps + typing), MCP-2180 (widget→view naming).
**v1 reference:** `packages/mcp-use` (`src/react/`, `src/server/widgets/`) defines *what* views must be able to do, never how. Parity with v1 is the alpha goal; the architecture is not carried over.

## Decisions at a glance

1. **One protocol: MCP Apps.** The [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) (`io.modelcontextprotocol/ui`, spec revision `2026-01-26` + draft) is the only wire format. The v1 adapter system (`AppsSdkAdapter`, dual-protocol metadata, `window.openai` transport) is **not ported**.
2. **Public naming is "view", everywhere.** `view` tool config, `view()` helper, `useView` hook, `ui://views/…`. "Widget" survives nowhere in the v2 API.
3. **`tool()` returns `ToolRef<Name, Input, Output>`** (not `this`). Typed `useCallTool` is pure type inference over exported refs — zero codegen, nothing generated on the dev/build hot path.
4. **Props flow like normal React props.** The runtime owns the iframe mount, so it renders `<View {...props} />` itself: the handler's `view({ props })` payload *is* the component's props — no hook pull, no v1 `toolInput`+`structuredContent` merge. An optional `Loading` export covers the no-props-yet window; hooks shrink to genuinely ambient concerns (host context, actions, tool input/streaming).
5. **The React runtime builds on `@modelcontextprotocol/ext-apps`** (guest `App` class); the server package **inlines** the few wire constants and emits spec `_meta` itself — no ext-apps import server-side.
6. **`view()` is the one response helper.** The no-response-helpers ground rule (`SPEC.md`) stands for everything else; `view()` earns its exception (rationale below).
7. **React runtime ships as the `/react` subpath** of this package, with `react` an optional peer — tool-only servers never pay for it.
8. **Parity with v1 hooks, minus two named gaps** (file upload, cross-session view state) that the MCP Apps spec cannot express — see "Dropped from v1".
9. **Views build into `.mcp-use/build/views/` and serve under `${basePath}/_mcp-use/`.** One Vite client-environment build for all views (shared content-hashed chunks), a manifest-driven registration + serving path identical for `start` and serverless, absolute asset URLs derived per request. v1's per-widget builds and `mcp-use/widgets` routes are not carried over — see "Build system & serving".
10. **At most one tool per view; view-bound tools declare an `outputSchema`; binding errors are one-directional.** A `view:` naming a missing view, a `view:` tool without an `outputSchema`, and a second tool binding an already-bound view are **hard errors** — the first emits a broken `resourceUri`, the second has no props contract to type (`ViewProps` reads the bound tool's `outputSchema`), the third breaks that contract (a second binder could deliver differently-shaped props the type denies). A view directory no tool binds is a **warning only** (unused-code class: harmless dead weight, and erroring would break the scaffold-view-first authoring order and make feature-flagging a tool off a deploy-breaking action). Relaxing to many-to-one later is additive; imposing 1:1 after shipping would break users. Two tools wanting the same UI = two thin `view.tsx` files sharing one component.
11. **Views register from the manifest as code — no filesystem on any MCP path.** `mcp-use build` bakes the views manifest into a generated wrapper entry that primes the server instance before anything mounts; `resources/read` and the document route synthesize the HTML from manifest data per request. No runtime `fs` read, and deliberately no fallback — an unprimed `view:` is a loud mount-time error. See "Registration mechanism".
12. **Dev shares the one Vite dev server `mcp-use dev` already runs.** The views client environment joins that server; view-file edits get real Vite HMR (pure client code), while the server entry keeps the implemented reload-and-swap contract (`CLI_SPEC.md`). Emitting `tools/list_changed`/`resources/list_changed` to connected clients on dev reload is **deferred** (it needs the notifications phase; under the stateless wire the next `tools/list` is always current anyway).

---

## The running example

Used throughout this document. One tool, one view, one schema — every snippet below agrees with this shape:

```ts
// src/index.ts (server entry)
import { MCPServer, view } from "@mcp-use/server";
import { z } from "zod";

const server = new MCPServer({ name: "fruit-store", version: "1.0.0" });

const resultsSchema = z.object({
  query: z.string(), // echoed from the input so the view can display it — props carry everything the component renders
  items: z.array(
    z.object({ id: z.string(), name: z.string(), imageUrl: z.string() })
  ),
});

export const searchFruits = server.tool(
  {
    name: "search-fruits",
    schema: z.object({ query: z.string().optional() }),
    outputSchema: resultsSchema,
    view: { name: "product-search-result" },
  },
  async ({ query = "" }) => {
    const items = await search(query);
    return view({
      props: { query, items },
      content: `Found ${items.length} fruits`,
    });
  }
);

export default server;
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
  return <Skeleton />; // optional; rendered until the first tool result arrives
}

export default function ProductSearchResult({ query, items }: ViewProps<"search-fruits">) {
  return <ResultsGrid query={query} items={items} />;
}
```

Note what makes this consistent: `query` reaches the component **because the handler echoes it into the output** — props are exactly the `view({ props })` payload (= `structuredContent`, typed by `outputSchema`), never a merge of tool input. A view that doesn't want input fields in props reads them from `useView().toolInput` instead.

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
| tool `_meta`     | `ui.visibility`                                             | `["model"]` / `["app"]` when `view.visibility` narrows it; **omitted entirely when unset** (host default: callable by the model, visible to the app) |
| resource         | `mimeType`                                                  | `text/html;profile=mcp-app`                                  |
| resource `_meta` | `ui.csp`, `ui.permissions`, `ui.domain`, `ui.prefersBorder` | from the view's `metadata` export — only the fields the export actually sets are emitted |

Security metadata (CSP, permissions) lives on the **resource**, never the tool — hosts ignore tool-level copies per spec.

### Capability gating (stateless-first)

Per the `SPEC.md` stateless posture, UI support is a **request-scoped** fact: the 2026-07-28 wire carries `clientCapabilities` in per-request `_meta`, and MCP Apps support is `capabilities.extensions["io.modelcontextprotocol/ui"]` advertising `mimeTypes: ["text/html;profile=mcp-app"]`. `tools/list` and `resources/list` responses may vary on that request-scoped capability (e.g. omitting `ui.*` meta, hiding app-only tools from non-UI hosts); nothing is ever inferred from remembered sessions. Tools with views always return meaningful `content` so text-only hosts degrade gracefully (spec SHOULD).

The framework does the list-time gating itself; the user-facing surface is one request-context query, `ctx.client.supportsViews()` (`RequestContext` grows per phase — this reads per-request capabilities, never session state):

```ts
export const searchFruits = server.tool(
  { name: "search-fruits", schema: z.object({ query: z.string().optional() }), outputSchema: resultsSchema, view: { name: "product-search-result" } },
  async ({ query = "" }, ctx) => {
    const items = await search(query);
    if (!ctx.client.supportsViews()) {
      // materially different output for text-only hosts (optional — see note)
      return {
        content: [{ type: "text", text: renderAsMarkdownTable(items) }],
        structuredContent: { query, items },
      };
    }
    return view({ props: { query, items }, content: `Found ${items.length} fruits` });
  }
);
```

Note the branch is *optional*: a `view()` result already degrades on text-only hosts (its `content` is present; the `ui.*` meta is ignored). `ctx.client.supportsViews()` exists for when the two audiences deserve materially different output, not as a required ritual.

### ext-apps dependency posture

As of the current ext-apps release, no published version supports the v2 SDK — it peer-depends on `@modelcontextprotocol/sdk@^1.x` (v1); the upstream v2-port PRs (#612, #614) were closed unmerged in favor of a not-yet-landed "SDK divorce" (vendoring the `Protocol` shim and types). Consequences:

- **Server side: write our own — deliberately, and it is small.** Ext-apps' server helpers (`registerAppTool`, `registerAppResource`, `getUiCapability`) take a v1 `McpServer` we don't have, and they were always thin sugar over registration this framework does itself. Our replacement: inlined wire constants (mimetype, `_meta.ui.*` keys, extension ID), `_meta` emission at tool/resource registration, and a `getUiCapability` equivalent over per-request `extensions["io.modelcontextprotocol/ui"]` — on the order of 100–200 lines plus pure type definitions vendored from ext-apps `spec.types.ts` (with attribution). The `SPEC.md` "no v1 SDK imports" ground rule is preserved.
- **View side: reuse essentially the whole guest protocol stack.** The React runtime wraps ext-apps' `App` + `PostMessageTransport`: handshake, capability negotiation, the event system with one-shot replay, all outbound methods (`callServerTool`, `sendMessage`, `openLink`, `requestDisplayMode`, `updateModelContext`, `sendLog`, `downloadFile`, size-changed/auto-resize, teardown), the complete app-tools implementation (`registerTool` — see View tools), style helpers, and the `McpUi*` types. The v1-SDK incompatibility does not bite here: the view never speaks the MCP wire — it speaks apps-spec postMessage to the *host* — so the v1 SDK inside is internal plumbing (`Protocol` base class, types, zod) that Vite tree-shakes into the view's **static browser assets** (the SDK's express/hono/ajv tree is unreachable from `app.ts`). A view built on the current ext-apps release works against a 2026-07-28 server. Our `/react` code is product surface only — hooks, props-injection wrapper, typing layer, dev overlay — no protocol code.
- **Host side (inspector, test harness): reuse `AppBridge` with `client: null`** — its explicit escape hatch for hosts without a v1 `Client`; request handlers (`oncalltool`, `onlistresources`, …) forward to the v2 client stack manually.
- **Dependency mechanics:** ext-apps (1.4 MB, one hard dep) is an **optional peer** of this package — the `vite` pattern from `CLI_SPEC.md`. View projects declare it (template does); tool-only servers install neither it nor its v1-SDK peer tree (~4.3 MB + express/hono/ajv/jose transitives), keeping the install-budget ground rule honest. Fallback if peer noise warrants: ext-apps' `app-with-deps`/`react-with-deps` bundled entries (cost: zod dedupe). When upstream's SDK divorce lands, the peer disappears and bundles shrink with no API change on our side.

---

## Server API

### File-based views (the first-class authoring path)

View components live under `resources/` (fixed convention, one directory per view, `view.tsx` as the component entry — the directory is named for what views *are* on the wire: MCP resources). There is deliberately no `viewsDir` knob in the alpha, matching `CLI_SPEC.md`'s no-config-file rule; a constructor field can be added later without breaking anything.

```
resources/
  product-search-result/
    view.tsx        # default-exports the component; named-exports `metadata` (and optional `Loading`)
    types.ts        # any other files in the directory are ordinary modules the view may import
```

A view file has three recognized exports, two of them borrowed from conventions agents already know (Next.js `metadata` / `loading.tsx`):

- the **default export** — the component, receiving props (see Props model),
- **`metadata`** (`ViewMetadata`, optional) — resource-level facts only: description, csp, permissions, domain, prefersBorder. The v1 requirement to hand-declare a zod `props` schema is gone; props types flow from the bound tool's `outputSchema`,
- optional **`Loading`** — rendered while no props exist (see Streaming).

Discovery registers one `ui://views/<dir-name>.html` resource per view, each bound by at most one tool (decision 10; an unbound view warns). The **build/dev manifest is the source of truth** for what views exist and what asset each serves — production never rediscovers the filesystem and never re-reads the manifest either: it reaches the runtime as code (Registration mechanism, below). Nothing depends on `handler.toString()`.

Inline JSX returned from tool handlers is a documented **stretch** authoring model and is out of this contract; it must layer on the file-based path without changing it.

### Binding a tool to a view

The `view:` config on `server.tool()` carries the relationship facts only:

```ts
view: {
  name: string;                    // view directory name, e.g. "product-search-result"
  visibility?: "model" | "app";    // → _meta.ui.visibility; omitted = host default (model + app)
}
```

Binding rules (decision 10), enforced where the wire would lie — at registration in dev, at build in prod:

- `view.name` naming a missing view directory is a **hard error** (broken `resourceUri`).
- A `view:` tool without an `outputSchema` is a **hard error** — the props contract *is* the `outputSchema` (`ViewProps<"search-fruits">` reads it; `view()` compile-checks against it). A view that takes no props binds to a tool with an empty object schema (`outputSchema: z.object({})`).
- A second tool binding an already-bound view is a **hard error** — type honesty: a second binder with a different output shape could deliver props the type says cannot exist.
- A view directory no tool binds is a **warning naming the view**, never an error — nothing on the wire is wrong (no host renders a view except through a tool result's `_meta.ui.resourceUri`), and erroring would punish the natural authoring order (view directory first, tool second) and turn feature-flagging a tool off into a build/deploy breaker. Unbound views are still built, registered, and served — `resources/read` and the document route staying live is useful for inspector preview of not-yet-wired views.

The check itself is a set difference at mount time — the frozen tool registry against the primed view registry — re-run per dev reload. Sharing a UI across tools stays trivial (two thin `view.tsx` files re-exporting one component), and relaxing to many-to-one later is a non-breaking change if real usage demands it, whereas the reverse migration would not be.

The v1 `invoking`/`invoked` strings and `widgetAccessible` flag are `openai/*` overlay concepts with no spec equivalent — dropped from the alpha config (space reserved in a future overlay, not here).

**Why `view:` stays `{ name, visibility }` and metadata stays in the view file:** the dividing rule is *component facts vs relationship facts*. CSP/permissions/domain/prefersBorder/description describe the component — they ship as **resource** `_meta.ui.*` (hosts ignore tool-level copies per spec, so putting them in `view:` would emit them where hosts don't read them), and they change in lockstep with the component's code (add a CDN fetch → CSP edit in the same file, which agents won't forget). `view:` carries only the relationship facts: which view, and the tool's model/app visibility. Per-tool presentation strings (e.g. a future `invoking`/`invoked` overlay) would belong in `view:` by the same rule. The 1:1 binding means per-tool vs per-view metadata never *conflicts* — the split survives on the spec-fact and lockstep arguments alone.

### The `view()` helper — the one exception to "no response helpers"

The no-helpers rationale (`SPEC.md`) was that `text()`/`object()`/`array()` were pure dialect over shapes models already know. `view()` is not dialect: it names the three result channels — which differ in *who sees them*, the thing the raw shape makes easy to get wrong. It returns a plain `CallToolResult`; handlers may still hand-build one.

```ts
function view<TOutput>(args: {
  props: TOutput;                       // → structuredContent — model AND view (typed by outputSchema)
  content?: string | ContentBlock[];    // → content — model + text-only hosts (spec-mandated fallback)
  meta?: Record<string, unknown>;       // → _meta — view ONLY; never enters model context
}): CallToolResult & { structuredContent: TOutput };
```

**How `view()` is compile-checked against `outputSchema` — no extra machinery.** The existing return-position contract does it: a tool with an `outputSchema` types its callback's return as `ToolResult<Output>`, which only accepts `CallToolResult & { structuredContent: Output }` (or an `isError` result — `src/tools.ts`). `view()`'s return type carries `structuredContent: TOutput` with `TOutput` inferred from `props`, so a `props` payload that doesn't match the tool's `outputSchema` fails at the handler's return position. `view()` needs no knowledge of which tool it's called from, no branding, and works only where it should: inside a schema'd tool's handler.

`view()` and the component are two ends of one call: `view({ props })` is conceptually "render the bound component with these props" — the runtime spreads exactly that payload onto the default export (Props model, below). The server side checks `props` against `outputSchema` at the return position; the view side types its parameters from the same schema via `ViewProps<Name>` — both ends check against one type, so they cannot drift.

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
- **`content` is the model/text-host narrative** ("Found 12 results, top match …"). Default when omitted: one `{ type: "text" }` block containing `JSON.stringify(props)` (satisfies the spec's meaningful-content SHOULD) — but since `props` are already model-visible as `structuredContent`, the default *duplicates tokens*; handlers should pass a short summary. The docs lead with an explicit `content`.
- **`meta` is the view-only channel** (v1's `widget({ metadata })`, kept): passed through into result `_meta` untouched, read via `useView().meta`, never typed by `outputSchema`, never model context. Not to be confused with the view file's `metadata` export (resource facts: CSP etc.) — different layer entirely.
- The reverse direction is explicit, not ambient: nothing a user does *inside* the view reaches the model unless sent via `ModelContext`/`updateModelContext` (model context push, no follow-up turn) or `sendFollowUpMessage` (`ui/message`, triggers a turn). A view tool's result is the third view→model channel, distinguished by being *model-initiated* (see View tools).

### URI scheme and serving

- Resource URI: `ui://views/<name>.html` — stable across builds. (v1 embedded a `buildId` for ChatGPT's per-URI caching; that is an overlay concern. If host caching demonstrably requires it, a content-hash suffix comes back via the manifest — deferred to implementation evidence, see Open questions.)
- The resource body is a complete HTML document (rendered by hosts via `srcdoc`) whose script/link tags load the view's built assets over HTTP from `${basePath}/_mcp-use/`. The document is **synthesized per request from the manifest entry** — never read from disk (see "Registration mechanism"). Dev serves assets through the Vite client environment; production serves prebuilt files from `.mcp-use/build/views/assets/`. The full contract — build pipeline, routes, origin derivation, caching — is "Build system & serving", below.

### Wire shape (reference — what our registration layer emits)

For the running example, `tools/list` carries:

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
      "csp": {
        "connectDomains": [],
        "resourceDomains": [
          "https://images.example.com",   // declared by the author in `metadata`
          "https://fruit-store.fly.dev"   // ← the request-resolved serving origin, auto-appended by the framework (see Serving)
        ]
      },
      "prefersBorder": true
    }
  }
}
```

`resources/read` returns the same fields with the view's HTML document as `text` (origin-resolved per request, identical to the HTTP document route — see Build system & serving). Requests from clients without the UI extension get these entries with `ui.*` meta omitted (and `visibility: "app"` tools hidden) — the request-scoped gating above.

---

## Build system & serving

Extends `CLI_SPEC.md`'s implemented workspace and command contract (its ground rules hold: `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk, no config file, fixed `.mcp-use/` layout). v1 reference: `packages/cli` `buildWidgets` + `packages/mcp-use/src/server/widgets/*` define what the pipeline must deliver — built assets, a manifest, HTTP serving, dev HMR — never how. The v1 mechanics (one Vite build per widget, scratch `entry.tsx`/`index.html` files in `cache/`, boot-time origin baking, regex rewriting of built HTML, `window.__getFile` indirection, auto-injected Tailwind) are **not** carried over.

### One client build, N entries

`mcp-use build` gains a **client environment** alongside the existing node/SSR build — one Vite build invocation, one entry per discovered view. Entries are **virtual modules** (`virtual:mcp-use/views/<name>`, resolved by the views plugin inside `src/cli/`), not scratch files: each imports the runtime's iframe bootstrap from the `/react` runtime and the view module, and mounts per the Props model (bridge connect, `Loading` → default-export swap, `tools: { listChanged: true }` capability). Nothing is written to `cache/` for entries; nothing user-visible is generated.

One build for all views means shared dependencies (React, the runtime, common components) land in **shared content-hashed chunks** instead of being duplicated per view (v1 rebuilt the world per widget — N× build time, N× React copies). Output:

```
.mcp-use/build/
├─ index.js                       ← generated wrapper entry: primes views, re-exports the server (see Registration mechanism)
├─ manifest.json
└─ views/
   └─ assets/
      ├─ product-search-result-D2f9a1Kc.js   ← per-view entry chunk
      ├─ chunk-Ca41x22b.js                    ← shared, content-hashed
      └─ product-search-result-B99z1bQd.css
```

There are **no HTML files in the build output**: the view document is a pure function of the manifest entry — a minimal shell (`<div id="root">`, module script for the entry chunk, `<link>` per CSS asset) — so the runtime synthesizes it per request instead of the build writing it to disk (see "Registration mechanism"). **Only the HTML needs absolute URLs** (hosts render the resource body via `srcdoc`, so there is no document base URL to resolve against); everything downstream is relative — the entry script tag's absolute URL makes `import.meta.url` absolute inside the iframe, so chunk-to-chunk dynamic imports and CSS `url()` references resolve relatively from there. So the build uses Vite's relative base, and the runtime interpolates the request-resolved origin into the shell's tags directly — no placeholder file, no rewrite step. This eliminates v1's entire rewrite layer (three regexes over built HTML + four injected `window.__*` globals) and the document files with it.

**User Vite config:** if the project has a `vite.config.ts`, the client environment resolves it normally and layers the views plugin on top — Tailwind, path aliases, and friends are the user's declaration, not framework magic (v1 silently injected Tailwind v4 + a generated `styles.css`; v2 templates declare `@tailwindcss/vite` themselves). The node/SSR environment ignores user client plugins per standard environment scoping.

### Manifest

Extends the `CLI_SPEC.md` manifest (`.mcp-use/build/manifest.json`) with a `views` map — the **source of truth** for registration and serving (Discovery, above: production never rediscovers the filesystem):

```jsonc
{
  "buildId": "…", "entryPoint": "index.js", "createdAt": "…", "inspector": true,
  "views": {
    "product-search-result": {
      "entry": "views/assets/product-search-result-D2f9a1Kc.js",
      "css": ["views/assets/product-search-result-B99z1bQd.css"],
      "metadata": { "description": "Product search results grid", "csp": { "connectDomains": [], "resourceDomains": ["https://images.example.com"] }, "prefersBorder": true }
    }
  }
}
```

The `views` map is emitted twice from one build-time source: into `manifest.json` (tooling and introspection — the `CLI_SPEC.md` workspace contract) and **baked into the generated wrapper entry as code** (the runtime's copy — see "Registration mechanism"). The runtime never reads the JSON file.

`metadata` is the view file's `metadata` export, extracted **at build time** by evaluating the view module in the node environment through the module runner (the component is never rendered; only module scope executes). Constraint this creates, documented: view modules must be importable under node — no `window`/DOM access at module top level (effects and render code are unaffected). A view whose module throws under node, or whose `metadata` fails to evaluate, is a **build error naming the view** — never a silently metadata-less resource. This replaces v1's per-widget ephemeral SSR Vite servers with the runner the build already has.

### Paths: manifest → URL → disk

One rule connects the three path spaces:

- **Manifest asset paths** (`entry`, each `css` item) are **relative to `.mcp-use/build/`** — e.g. `views/assets/product-search-result-D2f9a1Kc.js`.
- **On disk**, every view asset lands flat in the single directory `.mcp-use/build/views/assets/` (the client environment's Vite `assetsDir`). Content hashing makes basenames unique, so nothing nests deeper.
- **On the wire**, assets are addressed by **basename**: the asset route `GET ${basePath}/_mcp-use/assets/<file>` serves `.mcp-use/build/views/assets/<file>`, and document synthesis turns each manifest path into `<origin>${basePath}/_mcp-use/assets/<basename>`.

The `views/` segment exists on disk and in the manifest (paths relative to the build root, so tooling can locate files) but never in URLs.

### Registration mechanism

How manifest data becomes MCP registrations. Two facts about the implemented server shape every design must live under: the registry **freezes at first mount** (registration after `listen()`/`getHandler()` throws — registrations are replayed per request, late ones would be silently inconsistent), and `getHandler()` is **synchronous** and typically called at module scope in serverless entries. So view registration must be complete by the time the entry module finishes evaluating, and it cannot await a filesystem read to get there. v1's trigger — `mountWidgets()` doing async `fs` work *inside* `listen()`/`getHandler()`, then calling `server.uiResource()` — is structurally impossible here and is not wanted back.

**Instance registry, primed via an internal API.** `MCPServer` grows a views registry alongside `#tools`/`#resources`, populated through one symbol-keyed method:

```ts
// exported from the package root, tagged @internal (non-public by convention;
// physically reachable so generated code and the CLI can use it)
export const registerViews: unique symbol;

// on MCPServer:
[registerViews](views: ViewsManifest): void;   // throws if already primed, or after first mount

interface ViewsManifest {
  [viewName: string]: {
    entry: string;          // asset path, relative to .mcp-use/build/ (dev: the client-env module URL)
    css: string[];          // ditto
    metadata: ViewMetadata; // extracted at build time (dev: extracted via the module runner)
  };
}
```

The same package's CLI (`src/cli/`) imports the symbol directly; the generated wrapper entry imports it from the package root. View resources are *not* sugar over the public `resource()`: their `_meta.ui.*` emission is capability-gated per request and their body is origin-resolved per request, so the per-request SDK-server build does the emission itself — register each view's resource (mimetype, gated `_meta`, asset origin auto-appended to `csp.resourceDomains`), synthesize the document from the manifest entry on read, and stamp `_meta.ui.resourceUri` onto the bound tool. The tool-side URI needs no manifest data (deterministic from `view.name`); the primed registry's job at the tool boundary is validation — the binding checks of decision 10. Priming is deliberately an instance method, not a module global: no evaluation-order coupling, composes with several servers in one process, and re-runs naturally in dev's fresh-instance-per-reload loop. (Skybridge, the closest prior art, ships the same manifest-as-code mechanism but delivers it through a process-global `__setBuildManifest()` consumed by the next constructor; the instance API is our correction.)

**Delivery: the manifest travels as code.** `mcp-use build` builds the server bundle from a **generated wrapper entry** — the user's entry plus the views map baked in as inline data, priming before re-export. The user entry must default-export the `MCPServer` instance — the same entry contract `CLI_SPEC.md` already enforces for `dev` and `start`:

```ts
// .mcp-use/build/index.js (conceptually; generated, never user-visible)
import server from "<bundled user entry>";
import { registerViews } from "@mcp-use/server";
server[registerViews]({ "product-search-result": { entry: "…", css: ["…"], metadata: { /* … */ } } });
export default server;
```

Because priming happens during module evaluation of the built entry, it is complete before any downstream `getHandler()`/`listen()` call — and because it is part of the JS module graph, every bundler and file tracer (Vercel's nft, esbuild, Wrangler) carries it automatically. Per mode:

- **`start`:** imports the built entry; views are primed by the wrapper before `listen()`. Nothing new in the `start` contract.
- **Serverless:** the function entry imports `.mcp-use/build/index.js` (not the TS source — a views deployment necessarily has a build step, since the assets only exist post-build). Identical code path to `start`; the MCP surface (list/read/tool meta) needs **zero filesystem** at runtime.
- **Dev:** no wrapper — the CLI calls the same internal API on each freshly loaded instance (the module runner constructs a new `MCPServer` per entry reload) before wiring it into the swappable handler, feeding it the in-memory view registry. View add/remove/`metadata` changes trigger the existing reload-and-swap; view *code* edits never touch registration (pure client HMR).

**No fallback, loud errors.** There is deliberately no `fs` path anywhere on the MCP surface and no degraded mode: a tool declaring `view: { name }` on an instance with no primed views — or a name the primed registry doesn't contain — is a mount-time error naming the view and the fix (`run mcp-use build` / deploy the built entry). Cautionary precedent: Skybridge keeps a `readFileSync(manifest)` fallback for when priming was skipped, and it degrades *silently* in exactly the environments where it can't be debugged — serverless bundles that don't include the JSON, or any process whose cwd differs from the build layout; tools keep working, views render blank. That failure class is not made unlikely here; it is made inexpressible.

**Consequence, documented:** views make `mcp-use build` mandatory for deployment. The ships-unbuilt serverless shape (function entry importing the TS source directly, per the current `examples/vercel`) remains valid for tool-only servers; the views variant of the example imports the built entry.

### Serving

All framework HTTP surface lives under **`${basePath}/_mcp-use/`** — a framework-owned namespace inside the one mount point users already expose (underscore prefix = private-by-convention, the `_next` analog; v1's `${basePath}/mcp-use/widgets` naming is dropped). Everything under `basePath` means the existing handler covers MCP + assets with zero extra routing config on any platform — one Hono app, one serverless function, one exposed path prefix.

| Route | Serves | Cache-Control |
| --- | --- | --- |
| `GET ${basePath}/_mcp-use/views/<name>.html` | the view document, synthesized from the manifest entry and origin-resolved per request (same body as `resources/read`) | `no-store` |
| `GET ${basePath}/_mcp-use/assets/<file>` | content-hashed build assets, by basename (Paths, above) | `public, max-age=31536000, immutable` |

Asset filenames are content-hashed by the build, so HTTP caching needs no `buildId` anywhere in URLs (v1 put `buildId` in `ui://` URIs only; our URIs stay stable — Open questions). The HTML route exists for hosts that navigate an iframe to a URL, for the inspector, and for humans debugging in a browser; MCP hosts normally take the document from `resources/read`.

**Origin resolution is request-scoped** — the same posture as capability gating, and the piece v1 got structurally wrong (origin computed once at boot from `MCP_URL`/host:port, then string-patched into HTML). The synthesized document's asset URLs resolve per request to `<origin>${basePath}/_mcp-use/` where `<origin>` comes from, in order: an explicit override (for deployments whose edge doesn't forward — **shape deliberately unresolved**: whether this is a `publicUrl` config field or v1's `MCP_URL` environment variable is a pending separate discussion, see Open questions), standard `Forwarded`/`X-Forwarded-Proto`+`X-Forwarded-Host` headers, the request URL itself. The v1 mistake was *when* the override was read (boot-time baking), not the override existing; whatever its spelling, it is applied at emission time. No boot-time state — correct behind tunnels/proxies/preview deployments without restarts.

**CSP consequence:** hosts sandbox the view iframe and enforce the resource's `ui.csp`, so the view's own assets must be loadable — the registration layer **auto-appends the request-derived asset origin** to `csp.resourceDomains` when emitting resource `_meta` (that is the second `resourceDomains` entry in the wire-shape example above). View authors declare only *their* external domains (the `metadata` export); the framework's serving origin is its own concern. A fully-inlined single-file mode for hosts that refuse all external resources (v1's `--inline`, used for VS Code) is deliberately deferred — Open questions.

### Dev

`mcp-use dev` adds the client environment to the **same Vite dev server** the implemented CLI already runs (`CLI_SPEC.md`'s single process — today it runs the node/SSR environment only, with the Vite server in middleware mode), with its middleware mounted at `${basePath}/_mcp-use/` ahead of the MCP handler:

- View documents are synthesized per request (same shell, `@vite/client` + the virtual entry served through the middleware); assets flow through Vite transform — no build step, no manifest file. The in-memory view registry plays the manifest's role, kept current by Vite's watcher: add/remove view directories (or `metadata` changes) trigger the entry's existing reload-and-swap — a fresh `MCPServer`, re-primed via the internal API (Registration mechanism, above) — never mutation of a running instance; the next `tools/list`/`resources/list` reflects it.
- **View-file edits get Vite HMR.** This is the client half of the one dev server: view code is pure browser code, so Vite's own HMR channel applies to it. The server entry keeps `CLI_SPEC.md`'s implemented reload-and-swap contract untouched — its reload-not-HMR rule is about the *server* module graph, and views don't change that. `metadata` changes re-extract through the module runner on invalidation (they are registration data, so they ride the reload path, not HMR).
- **Deferred:** emitting `tools/list_changed`/`resources/list_changed` to connected clients when a dev reload changes the registry. Under the stateless wire the next `tools/list` is always current, so nothing is ever stale — the notification is a nicety for long-lived clients (the inspector), and it lands with the notifications phase (`SPEC.md`), not with views.
- `view.name` → directory validation (Server API, above) runs at registration in dev and at build in prod — same check, two enforcement points.

### `start` and serverless

`mcp-use start` imports the built wrapper entry — views arrive already primed (Registration mechanism, above) — and serves prebuilt assets per the manifest data: no vite, no discovery, no cli chunk (the routes, document synthesis, and origin resolution live in the runtime package). Serverless targets get the identical code path: the function entry imports `.mcp-use/build/index.js` and `getHandler()` serves the same routes. The MCP surface needs zero filesystem; **assets are the one remaining fs-shaped thing**, handled per platform: node/`start` reads `.mcp-use/build/views/assets/` directly; Vercel functions have a real fs and need only file tracing (one `vercel.json` `includeFiles` line — the views variant of `examples/vercel` ships it); Cloudflare Workers use Workers Static Assets on the asset route (or the `nodejs_compat` `/bundle` VFS via module rules). And the escape hatch works everywhere: the origin override + any CDN/static host in front of `${basePath}/_mcp-use/assets/` works unmodified, since asset responses are immutable.

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

Users export the refs of tools views care about (`export const searchFruits = server.tool(…)`) — the module is the registry; no map API, no `export type AppType` ritual, no user-written `declare module`. The name union covers **every exported ref** regardless of `visibility` (a view may call model-visible tools too; `visibility: "app"` only hides a tool from the model). `typeof import()` is a live tsserver edge: add a tool, and every view's `useCallTool` union updates with no process running. Multi-file registration composes via re-exports (`export * from "./tools/fruits.js"`).

`ViewProps` and `LoadingProps` resolve through the same map, keyed by the **bound tool's name**:

```ts
type ViewProps<Name extends keyof RegisteredTools> = RegisteredTools[Name]["output"];

type LoadingProps<Name extends keyof RegisteredTools> = {
  partialInput?: DeepPartial<RegisteredTools[Name]["input"]>;
  isStreaming: boolean;
};
```

Keying by tool name (not view directory name) is deliberate: view names exist only in the filesystem/manifest, which type space cannot see without codegen — tool names exist as literal types on exported refs. The tool-name parameter is the author's declaration of which tool binds the view; it is not enforced in type space (a wrong literal compiles against the wrong schema), the runtime binding checks at mount/build (decision 10) are the enforcement. Unbound views (inspector-preview only) don't use `ViewProps` — they receive `{}` and declare no required props.

**Note for cutover:** the `declare module` specifier must match the published import path — it becomes `"mcp-use/react"` when the package renames. The scaffolded file is the only thing that changes.

### Fallback ladder

1. `useCallTool("name")` — primary; typed via `Register` when the project has `register.d.ts` and the ref is exported.
2. `useCallTool(toolRef)` — for contexts where the ref value is legitimately in scope (the inline-JSX stretch path); not for file-based views (value import = server code in the bundle).
3. `useCallTool<Args, Result>("name")` — explicit generics for dynamically registered tools (statically untypeable in any framework) and unexported refs.
4. Empty `Register` (no `register.d.ts`) degrades to `(name: string)` — non-scaffolded projects compile untouched.

A forgotten `export const` silently drops that one tool to rung 3/4 — documented habit; a lint rule is a possible follow-up, not alpha scope.

### Typegen, demoted

Nothing generates types during `dev`, `build`, or `start` — v1's run-the-server generator (`tool-registry-generator.ts`, `zod-to-ts.ts`) is not ported, and the implemented CLI has no typegen hooks to remove. `mcp-use typegen` (+ `mcp-use check` for CI freshness) is the explicit secondary mode, for consumers with no compile-time path to the server source; if/when built, it is a TS-checker-based static extractor (reads resolved `ToolRef` types; never executes user code), defaulting output to `.mcp-use/generated/`. Not an alpha deliverable.

Since v2 `create-mcp-use-app` templates don't exist yet, the handwritten example in this package (planned `examples/views`) is the reference for the `register.d.ts` + exported-refs pattern.

---

## React runtime (`/react` subpath)

`@mcp-use/server/react` (→ `mcp-use/react` at cutover). Browser-only code built on the ext-apps guest `App` (one instance per iframe, connected once via `PostMessageTransport`); `react` and `react-dom` are optional peers; importing the subpath from server code is unsupported. The v1 hook *surface* is kept (renamed); the v1 transport guts (three-provider selection, `window.openai` branch, hand-rolled `McpAppsBridge`) are not.

### Props model

The generated iframe entry — not user code — subscribes to the bridge and renders the view, so data arrives as **normal React props**:

- **`props` = the `view({ props })` payload, exactly.** The runtime spreads the tool result's `structuredContent` onto the default export. No hook pull required, and no v1-style merge of `toolInput` into props (that merge conflated two channels with different types and timing). Tool input remains available via `useView().toolInput`; the view-only `meta` channel via `useView().meta` (see Channel visibility). A handler that wants input fields visible to the component echoes them into the output — the running example echoes `query`.
- **Before the first tool result there are no props**: the wrapper renders the optional `Loading` export instead; absent that, nothing. This replaces v1's in-component `isPending` branching. `Loading` receives the streaming state as *its* props — see Streaming, below.
- **Later tool results re-render with new props** — ordinary React update semantics, nothing bespoke.
- **Typing:** `ViewProps<"tool-name">` resolves the bound tool's `outputSchema` type through the same `Register` machinery as `useCallTool` — the server end (`view()` vs `ToolRef`) and the view end check against one type. Hand-written interfaces also work; props are structurally just the payload.
- **Views not bound to a tool** (warned at mount — decision 10) receive `{}` if something renders them anyway (inspector preview); such components declare no required props and don't use `ViewProps`.
- Escape hatches for migration and deep children: `useView().props` and `useViewProps()` return the same payload (they are `undefined` until the first result — the mounted component, by contrast, only ever renders with the payload present).

### Streaming

Two distinct things can stream, and only one of them exists on the wire today:

**1. Tool *arguments* stream — supported** (spec: `ui/notifications/tool-input-partial`). Hosts deliver progressively parsed arguments while the model is still generating the call — the pre-result window, which is exactly `Loading`'s territory. The wrapper passes the stream in as `Loading`'s props, typed from the tool's **input** schema:

```tsx
export function Loading({ partialInput, isStreaming }: LoadingProps<"search-fruits">) {
  return <SearchSkeleton query={partialInput?.query} />;
}
```

`LoadingProps<Name>` = `{ partialInput?: DeepPartial<Input>; isStreaming: boolean }` — deep-partial because streamed JSON is incomplete by nature (objects missing fields, string values possibly truncated mid-token: treat as provisional, render-only, never act on them). `useView().partialToolInput` exposes the same stream for components that stay mounted across the transition. Note the deliberate type-source flip: `Loading` types from the tool's `schema` (input), the default export from its `outputSchema` (props) — both read off the same `ToolRef`.

`Loading` deliberately mirrors Next.js's `loading.tsx`: pending UI is a separate render target the runtime swaps in, never an `isPending` branch inside the component — a convention agents already know. The difference is that our `Loading` is *fed*: it re-renders with progressively richer `partialInput` on every partial notification, so the pre-result phase can be a live experience, not just a static skeleton.

**"Streaming props" (the generative-UI recipe).** When the thing to render *is* what the model is writing (a drawing, generated UI code, long-form content — the Excalidraw MCP app pattern), put that payload in the tool's **input** schema and echo it into props. The argument stream then drives the UI in real time through `Loading`, and the final render is the same visual surface with complete, honestly-typed data:

```ts
// server — the model streams `elements` while writing the call; the handler echoes it into props
export const draw = server.tool(
  {
    name: "draw",
    schema: z.object({ elements: z.array(elementSchema) }),
    outputSchema: z.object({ elements: z.array(elementSchema) }),
    view: { name: "canvas" },
  },
  async ({ elements }) => view({ props: { elements }, content: `Drew ${elements.length} elements` })
);
```

```tsx
// resources/canvas/view.tsx — one visual surface, two typed entry points
function Canvas({ elements, streaming }: { elements: Element[]; streaming: boolean }) {
  /* renders whatever exists so far */
}

export function Loading({ partialInput, isStreaming }: LoadingProps<"draw">) {
  // DeepPartial: elements appear one by one as the model writes them; the last may be incomplete
  return <Canvas elements={partialInput?.elements ?? []} streaming={isStreaming} />;
}

export default function Draw({ elements }: ViewProps<"draw">) {
  return <Canvas elements={elements} streaming={false} />;
}
```

Schema guidance that falls out: **declare streamable payloads as structured schema, not JSON-in-a-string.** Hosts heal the *outer* argument JSON, so a `z.array(...)` field arrives as a partial array of typed elements; a stringified payload arrives truncated mid-token and the view must re-heal it by hand (the shipped Excalidraw app pays exactly that cost). Views that build up DOM/state during streaming and must survive the `Loading` → default-export swap are the continuity case tracked in Open questions.

**2. Tool *results* do not stream — wire fact, honest alpha posture.** The 2026-07-28 protocol and the apps spec deliver exactly one `ui/notifications/tool-result` per call: there is no partial-`structuredContent` channel, so "streaming props from the handler" (generator-style callbacks yielding progressive results) is not expressible and is **not** faked in the framework (no polling/chunking shims). Progressive UIs *pull* instead: the view calls tools via `useCallTool` and owns that state locally (those results return to the caller; they do not become new props). If the protocol later grows partial tool results, they map onto the props model as ordinary re-renders — same channel, more deliveries, no API change; tracked in Open questions.

### View tools (`useViewTool`)

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

- **React lifecycle = tool lifecycle.** Register on mount, `remove()` on unmount, `update()` on config change, `enabled: false` → `disable()` without unmounting (a disabled tool stays registered but is not listed/callable); ext-apps emits `tools/list_changed` automatically, so the host's tool list always matches the mounted UI (strict-mode double-mount is safe: remove + re-register).
- **Latest-closure handler:** the registered callback delegates through a per-render ref (`useEffectEvent` pattern) — handlers always see current state, no re-registration per render.
- **Connect-time capability:** ext-apps only auto-advertises the `tools` capability for pre-connect registrations, and hooks run post-connect — so the generated iframe entry always declares `tools: { listChanged: true }`. Harmless for views with no tools (empty list).
- **Not in `Register`:** view tools never appear on the server's `tools/list` and are never callable from views — typing them into `useCallTool` would advertise calls nobody can make. Their input/output types live and die inside the component.
- **Progressive enhancement only:** no host capability promises app-tool support; hosts that support it list/call, others ignore. Registration is unconditional and cheap; views must not depend on view tools being invoked.
- **Channel note:** a view tool's result (`content`/`structuredContent`) flows host→model — the third explicit view→model channel (alongside `updateModelContext` and `ui/message`), distinguished by being *model-initiated*.

### `/react` API reference

The complete alpha surface. Everything here is exported from `@mcp-use/server/react`; types marked *vendored* alias the ext-apps `spec.types.ts` definitions (carried with attribution, per the dependency posture).

**Types.**

```ts
/** Resource-level facts about a view; named-exported as `metadata` from view.tsx. */
interface ViewMetadata {
  /** Human-readable description → the resource's `description`. */
  description?: string;
  /** CSP domains the host must allow → resource `_meta.ui.csp`. The framework
   *  auto-appends its own serving origin to `resourceDomains` at emission time. */
  csp?: { connectDomains?: string[]; resourceDomains?: string[] };
  /** Sandbox permissions the view needs → `_meta.ui.permissions` (vendored spec shape). */
  permissions?: UiPermissions;
  /** Dedicated origin hint for hosts that render views on a separate domain → `_meta.ui.domain`. */
  domain?: string;
  /** Ask the host to draw a border around the view → `_meta.ui.prefersBorder`. */
  prefersBorder?: boolean;
}

/** Augmented by the project's register.d.ts; empty by default. */
interface Register {}

/** Props of the component bound to tool `Name`: the tool's inferred output type. */
type ViewProps<Name extends keyof RegisteredTools> = RegisteredTools[Name]["output"];

/** Props of the optional `Loading` export: the streaming pre-result window. */
type LoadingProps<Name extends keyof RegisteredTools> = {
  partialInput?: DeepPartial<RegisteredTools[Name]["input"]>;
  isStreaming: boolean;
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

**`useView<Name?>()`** — the ambient hook: everything about the current tool call and host that isn't component props. The optional type parameter (a registered tool name) types the data channels; omitted, they are `unknown`.

```ts
function useView<Name extends keyof RegisteredTools = never>(): ViewHandle<Name>;

// Below, Input/Output stand for RegisteredTools[Name]["input"/"output"];
// when the type parameter is omitted they are `unknown`.
interface ViewHandle<Name> {
  // data channels (undefined until the host delivers them)
  props: Output | undefined;              // last result's structuredContent — same payload the component gets
  toolInput: Input | undefined;           // complete tool arguments
  partialToolInput: DeepPartial<Input> | undefined; // the argument stream (Loading's feed)
  isStreaming: boolean;                   // argument stream in progress
  isPending: boolean;                     // input received, no result yet — for components that stay
                                          // mounted across the window; the Loading export is the primary path
  meta: Record<string, unknown> | undefined; // result _meta — the view-only channel

  // host context (re-renders on ui/notifications/host-context-changed)
  theme: "light" | "dark";
  locale: string; timeZone: string; userAgent: string;
  displayMode: "inline" | "fullscreen" | "pip";
  safeArea: SafeAreaInsets; maxHeight: number | undefined; maxWidth: number | undefined;
  hostInfo: HostInfo | undefined;         // getHostVersion()
  hostCapabilities: HostCapabilities | undefined; // getHostCapabilities()
  hostContext: HostContext | undefined;   // the raw object (vendored type)
  isAvailable: boolean;                   // bridge connected

  // actions (stable identities; v1 argument shapes kept)
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>; // untyped; prefer useCallTool
  sendFollowUpMessage: (args: { prompt: string }) => Promise<void>;  // ui/message — triggers a model turn
  openExternal: (args: { url: string }) => void;                     // App.openLink
  requestDisplayMode: (args: { mode: "inline" | "fullscreen" | "pip" }) => Promise<void>;
}
```

**`useCallTool(...)`** — typed server-tool calls from the view, over the bridge (`App.callServerTool`). Three signatures form the fallback ladder (Typing, above):

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
```

**`useViewTool(definition, handler)`** — view-registered tools (contract above). `definition` mirrors `ToolDefinition` plus `enabled?: boolean`; the handler's params/return are inferred exactly like a server tool's.

**`useViewProps()`** — migration escape hatch; returns the same payload as `useView().props`.

**`useViewState<T>(initial: T): [T, (next: T) => void]`** — local UI state, **iframe lifetime only**. Not persisted by the host, not model-visible (see "Dropped from v1" for the deliberate split from v1's `setWidgetState`).

**`useViewTheme()`** — the host theme on a dedicated subscription (avoids a full-`useView` rerender for theme-only consumers).

**`<ModelContext content={string}>{children?}</ModelContext>`** and **`modelContext.set/remove/clear`** — the explicit view→model channel, API carried from v1 unchanged: components register `content` in a parent-child tree, nested `<ModelContext>` elements serialize as an indented list, updates batch per microtask and push over `ui/update-model-context`; the imperative `modelContext` API covers non-React call sites (event handlers, stores) with stable keys.

**Providers and components.** The generated iframe entry owns the essentials itself — bridge connection, mount, `Loading`/component swap, auto-resize, a top-level error boundary — so **no provider is required**. `<McpUseProvider>` remains as the opt-in wrapper bundling theme application + error-boundary customization; `<ThemeProvider>` applies host style variables/fonts (ext-apps `applyDocumentTheme`/`applyHostStyleVariables`/`applyHostFonts`); `<ViewControls>` is the dev-only overlay (v1's `WidgetControls`, renamed); `<ErrorBoundary>` and `<Image>` are carried unchanged.

### Putting it together — a complete view

Reference sketch exercising the full surface (the `examples/views` example follows this shape). Server side, the running example plus one more exported tool:

```ts
// src/index.ts (server) — refs exported so Register picks them up
export const searchFruits = server.tool(/* the running example above */);

export const getFruitDetails = server.tool(
  {
    name: "get-fruit-details",
    schema: z.object({ fruit: z.string() }),
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

export default function ProductSearchResult({ query, items }: ViewProps<"search-fruits">) {
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
      {/* explicit, ambient model visibility (no model turn) — the other view→model
          paths are sendFollowUpMessage (triggers a turn) and view-tool results */}
      <ModelContext content={`User is viewing results for "${query}"; favorites: ${favorites.join(", ") || "none"}`} />

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

Everything data-shaped enters through props (typed by the server's `outputSchema`; `query` is there because the handler echoes it); everything ambient or imperative goes through hooks; the view→model paths (`ModelContext`, `sendFollowUpMessage`) are visible and explicit in the JSX. For tools not in the `Register` (dynamic registration, unexported refs), the explicit-generics rung applies with hand-written types: `useCallTool<{ fruit: string }, { name: string; producer: string }>("get-fruit-details")`.

### Hook surface (v1 → v2 → backing primitive)

| v1                                                                                                      | v2                                                                                        | Backed by                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useWidget()`                                                                                           | `useView()`                                                                               | `App` events + `getHostContext()`                                            |
| — `props` / `toolInput` / `output`                                                                      | `props` / `toolInput` (`output` folds into `props` — both were the result payload; primary path is component props) | `ontoolinput` / `ontoolresult`                                               |
| — `metadata`                                                                                            | `meta` — the view-only result channel (never model-visible)                               | result `_meta` from `ontoolresult`                                           |
| — `partialToolInput` / `isStreaming`                                                                    | same                                                                                      | `ontoolinputpartial`                                                         |
| — `isPending`                                                                                           | kept, for components that stay mounted across the window (primary path is the `Loading` export) | input-received-but-no-result state                                           |
| — `theme` / `locale` / `timeZone` / `userAgent` / `displayMode` / `safeArea` / `maxHeight` / `maxWidth` | same                                                                                      | `hostContext` + `onhostcontextchanged`                                       |
| — `callTool`                                                                                            | same (untyped; prefer `useCallTool`)                                                      | `App.callServerTool`                                                         |
| — `sendFollowUpMessage`                                                                                 | same                                                                                      | `App.sendMessage` (`ui/message`)                                             |
| — `openExternal`                                                                                        | same                                                                                      | `App.openLink`                                                               |
| — `requestDisplayMode`                                                                                  | same                                                                                      | `App.requestDisplayMode`                                                     |
| — `hostInfo` / `hostCapabilities` / `hostContext` / `isAvailable`                                       | same                                                                                      | `getHostVersion` / `getHostCapabilities` / `getHostContext`                  |
| `useWidgetProps()`                                                                                      | `useViewProps()` — migration escape hatch; primary path is component props                | thin wrapper                                                                 |
| `useWidgetState()`                                                                                      | `useViewState()`                                                                          | local state only — see semantics change below                                |
| `useWidgetTheme()`                                                                                      | `useViewTheme()`                                                                          | dedicated `hostcontextchanged` subscription (not a full-`useView` rerender)  |
| `useCallTool(name \| ref)`                                                                              | kept, typed via `Register`/`ToolRef`                                                      | `App.callServerTool`                                                         |
| *(no v1 equivalent)*                                                                                    | `useViewTool()` — view-registered tools the host/model calls (see View tools)             | `App.registerTool` + `tools/list_changed`                                    |
| `<McpUseProvider>`                                                                                      | kept (optional — the generated entry covers the essentials)                               | auto-resize via `App`'s built-in `autoResize`; theme; error boundary         |
| `<ThemeProvider>`                                                                                       | kept                                                                                      | ext-apps `applyDocumentTheme` / `applyHostStyleVariables` / `applyHostFonts` |
| `<WidgetControls>`                                                                                      | `<ViewControls>`                                                                          | dev-only overlay, ported                                                     |
| `<ModelContext>` / `modelContext`                                                                       | kept                                                                                      | `App.updateModelContext` (`ui/update-model-context`)                         |
| `<ErrorBoundary>`, `<Image>`                                                                            | kept                                                                                      | unchanged                                                                    |
| `generateHelpers()`                                                                                     | dropped                                                                                   | subsumed by `Register` typing                                                |

### Dropped from v1 (spec gaps)

- **`useFiles()` (upload):** file upload does not exist in MCP Apps (upstream: "not yet implemented"); it is a ChatGPT-only `window.openai` extension. Dropped from the alpha; host-mediated *download* (`ui/download-file`, draft) may land later.
- **Cross-session view state:** `window.openai.setWidgetState`'s host-persisted-and-restored state has no spec equivalent. `useViewState` becomes honest **local state** (lives for the iframe's lifetime). Model visibility is a separate, explicit act via `ModelContext`/`updateModelContext` — v1's conflation of "UI state" and "model context" in one `setState` is deliberately split.
- **`_meta.openai/*` emission** (`outputTemplate`, `widgetCSP`, invocation strings, …): overlay territory, out of the alpha (see Protocol posture).

---

## CLI integration

The full build/serve contract is "Build system & serving", above; it extends the **implemented** `CLI_SPEC.md` (which scoped views out) and its ground rules hold — reload-not-HMR for the server entry, `start` pays zero toolchain cost, vite reachable only through the lazy `dev`/`build` chunk. Command summary:

- **`mcp-use dev`:** adds the Vite client environment to the existing dev server; view documents/assets serve through its middleware at `${basePath}/_mcp-use/`. View-file edits get Vite's own HMR (pure client code, sharing the one Vite dev server); server-entry edits follow the existing reload contract. `list_changed` emission on reload stays deferred (decision 12). No typegen hooks anywhere.
- **`mcp-use build`:** one client-environment build over all views into `.mcp-use/build/views/`; writes the manifest `views` map (tooling copy) and bakes it into the generated wrapper entry (runtime copy — Registration mechanism); extracts each view's `metadata` via the module runner; runs the binding checks (missing view, missing `outputSchema`, double binding → errors; unbound view → warning).
- **`mcp-use start`:** imports the built wrapper entry (views arrive primed) and serves prebuilt assets; no vite, no discovery, no runtime manifest read.

## Testing

- **Type-level** (`tests/type-level.test.ts` pattern): `ToolRef` name/input/output inference incl. non-zod Standard Schema libs; `ToolsFromModule` filtering and re-export composition; `useCallTool` name union + arg/result types; empty-`Register` fallback; `view()` props-vs-`outputSchema` agreement at the return position; `ViewProps` (output) vs `LoadingProps` (deep-partial input) source flip; `DeepPartial` over arrays/nested objects.
- **e2e over HTTP** (official client): view resource listing/reading with correct mimetype and `_meta.ui.*` (only author-set metadata fields emitted); capability-gated `tools/list` variance from per-request `_meta`; `ui.visibility` emitted only when `view.visibility` is set; **channel separation** — `view({ props, content, meta })` lands as `structuredContent` / `content` / `_meta` respectively, with `meta` absent from everything model-facing.
- **Build/serve** (CLI-test pattern from `tests/cli/`, real `build` against a views fixture): manifest `views` map shape; the built wrapper entry primes registration with zero `fs` on the MCP path (list/read succeed with the built assets dir absent; only asset routes 404); document + asset routes under `${basePath}/_mcp-use/` with correct cache headers; the manifest→URL→disk basename mapping; per-request origin resolution (proxy headers, override) reflected in both the HTTP document and the `resources/read` body; asset origin auto-appended to `csp.resourceDomains`; a node-incompatible view module fails the build naming the view; the binding checks — `view.name` naming a missing view, a `view:` tool without `outputSchema`, and two tools binding one view fail loudly naming the view/tool, a view directory no tool binds warns (build still succeeds, view still registered).
- **Bridge-level:** a minimal `AppBridge` (ext-apps host class, devDep) driving a built view — initialize handshake, `tool-input-partial` sequence rendering `Loading` with progressive `partialInput`, tool-result delivery swapping `Loading` for the component with props, `tools/call` round-trip through `useCallTool` (`data`/`error`/`isPending` transitions), `meta` surfaced on `useView().meta`; **view tools** — `bridge.listTools()` reflects mounted `useViewTool`s, call round-trip mutates component state, unmount/`enabled: false` emits `list_changed` and removes/disables.

## Deltas vs v1 (for the migration guide)

1. Every `widget` name → `view` (`widget:` config, `widget()` helper, `useWidget*`, `WidgetControls`, `ui://widget/…` → `ui://views/…`).
2. Components receive props directly (`<View {...props} />` from the runtime); `useWidget().props` / `useWidgetProps()` become `useView().props` / `useViewProps()` escape hatches. Props are the `view({ props })` payload only — v1's `toolInput` merge is gone (read input via `useView().toolInput`, or echo input fields into the output schema).
3. `widgetMetadata` export → `metadata` (`ViewMetadata`); its zod `props` schema requirement is dropped — props types come from `outputSchema` (now required on view-bound tools).
4. In-component `isPending` skeleton branching → optional `Loading` export.
5. `useCallTool` types come from exporting tool refs, not from generated `.mcp-use/generated/tool-registry.d.ts`; template `postinstall`/dev-loop typegen is gone.
6. `useViewState` no longer persists across sessions nor implicitly feeds the model; use `ModelContext` for model visibility.
7. `useFiles` removed (ChatGPT-only capability).
8. `window.openai` is never consumed by the runtime; ChatGPT works through its native MCP Apps support.
9. Tool config `invoking`/`invoked`/`widgetAccessible` removed (openai overlay, no spec equivalent; `visibility` covers app/model narrowing).
10. Views work against the stateless 2026-07-28 wire; nothing view-related depends on sessions.
11. Asset routes move from `${basePath}/mcp-use/widgets/…` to `${basePath}/_mcp-use/…`; build output from `.mcp-use/build/resources/widgets/<name>/` to one shared-chunk build in `.mcp-use/build/views/`. Boot-time origin baking and the `window.__getFile`/`__mcpServerUrl` globals are gone — origin resolves per request (forwarded headers, plus an override whose shape — `publicUrl` config vs v1's `MCP_URL` — is pending, see Open questions); `assetPrefix` has no v2 equivalent (a CDN fronts the asset route instead).
12. Registration no longer happens inside `listen()`/`getHandler()` (v1's async `mountWidgets` → `server.uiResource()`): the build primes the instance through a generated wrapper entry, and `resources/read` synthesizes the document from manifest data instead of re-reading built HTML from disk on every read. `server.uiResource()` has no v2 equivalent, and neither do v1's `exposeAsTool` / hand-built `uiResource` registrations — a view is bound by at most one tool via `view: { name }`, and an unbound view warns (decision 10).

## Open questions

- Stable `ui://views/<name>.html` vs content-hashed URIs: revisit only with evidence that a target host over-caches by URI (v1's `buildId` existed for ChatGPT; ChatGPT's MCP Apps path may not need it). External evidence: Skybridge appends `?v=<content-hash>` to view URIs in production — a second framework independently concluding hosts over-cache by URI. Expectation is this resolves toward a manifest-driven hash suffix once tested against ChatGPT; still deferred to that test, not decided here.
- **Origin override: `MCP_URL` vs `publicUrl`.** The request-scoped resolution order is decided (override → forwarded headers → request URL, applied at emission time); the override's surface is not — v1 shipped `MCP_URL` as an environment variable, and what of its v1 role carries into v2 deserves its own discussion. Until then this spec names it only "the override".
- `ui/download-file` (draft) exposure — as a `useView` action or standalone hook — once a target host ships it.
- Partial/streamed **tool results**: not in the 2026-07-28 protocol or the apps spec today (see Streaming). When a partial-result channel lands upstream, deliver it as ordinary prop re-renders; until then, progressive UIs pull via `useCallTool`.
- **Continuity across the `Loading` → default-export swap** (raised by the Excalidraw MCP app): views that build DOM/state during the streaming phase (morphdom-diffed SVG, animation refs) lose it when the result-time remount swaps components. Candidate design: an opt-in single-component "phased" mode — one always-mounted default export with discriminated-union props (`{ phase: "streaming", partialInput, isStreaming } | { phase: "ready", ...props }`), the runtime rendering both phases at the same tree position. Whether that mode also becomes the blessed answer for authors who prefer one component over the `Loading` export (vs. keeping the split as the strong default) is still being debated; rejected regardless: union props as the *default* contract (protocol branching in every component), and "export the same function as both `Loading` and default" as a documented continuity contract (relies on reconciliation identity; fragile under HMR/wrappers). Full option space, evidence, and post-alpha re-evaluation plan: `../view_lifecycle_proposals.md`.
- **Single-file inline mode** (v1's `--inline`, all JS/CSS inlined into the HTML document): needed only for hosts whose CSP refuses all external resources (VS Code was v1's case). Deferred until a target host demands it; when it comes back it is a per-view build flag whose prebuilt single-file document rides the manifest and replaces synthesis for that view, with the asset routes unused.
- Sampling from views (`createSamplingMessage`, draft) — post-alpha, follows the server package's sampling posture (`SPEC.md`, elicitation & context phase).
- Overlay mechanism shape (if a host demands `openai/*` keys): registration-boundary transform, opt-in per server or per host detection — design when needed.
