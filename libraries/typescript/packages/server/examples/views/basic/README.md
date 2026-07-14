# Views example (Fruit Store)

Reference MCP Apps views server for `@mcp-use/server`. It follows the
[Views spec](../../../specs/VIEWS_SPEC.md) fruit-store shape: view-bound tools,
view components under `resources/`, typed tool I/O via exported tool refs, and
the full React runtime surface (`useToolContext`, `useCallTool`, `useViewTool`,
and the per-action hooks).

## What this demonstrates

- **File-based views** under `resources/<name>/view.tsx`, discovered by
  `mcp-use dev` / `build` / `start`.
- **One tool ↔ one view** via `view: { name, description, prefersBorder, … }` on
  `search-fruits`, with output typed from the tool's `outputSchema`. Resource
  facts (description, CSP, permissions, domain, prefersBorder) are declared on
  that binder's `view:` config. A second tool cannot bind the same view —
  use a separate view resource, or call helpers from the view with
  `useCallTool`. Tool `visibility` is a top-level tool field, not inside
  `view:`.
- **Default `viewConfig`** — this view exports no `viewConfig`, so the runtime
  defaults apply (`autoResize: true`, display modes `inline` / `fullscreen` /
  `pip`).
- **Explicit presentation composition** — the default export wraps content in
  `ThemeProvider` and `ViewControls` directly (there is no `McpUseProvider`).
- **Zero-codegen typing** via `src/tools.d.ts` and exported tool refs
  (`searchFruits`, `getFruitDetails`).
- **Capability gating** — `search-fruits` returns a markdown table fallback when
  the client does not advertise MCP Apps support.
- **Hook-first data flow** — the default export takes no props; tool output
  arrives via `useToolContext<"search-fruits">()` once `status === "ready"`.
- **Tool-error handling** — `status === "error"` distinguishes
  `ToolError` from `InvalidToolResultError` (`instanceof`); `useCallTool`
  rejects tool errors (success-only `data`, with `structuredContent` typed
  because `get-fruit-details` declares an `outputSchema`).
- **`useViewTool` without an opt-in flag** — `highlight-fruit` registers when
  mounted and is removed on unmount.
- **Tailwind CSS v4** — styling is the project's own declaration via
  `vite.config.ts` (`@tailwindcss/vite`) and `@import "tailwindcss"` in each
  view's `view.css`. The CLI's client build picks up the project Vite config
  automatically (see
  [Views spec — User Vite config](../../../specs/VIEWS_SPEC.md#one-client-build-n-entries)).

## Run locally

From this directory:

```sh
pnpm install   # once, from the monorepo root or here
pnpm dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`. Preview the view
through the built-in inspector (linked in the dev server log): open the
`ui://views/product-search-result.html` resource via `resources/read`.

Production path:

```sh
pnpm build && pnpm start
```

## Typing (`tools.d.ts`)

View bundles never import server code. Types cross in type-space only:

```ts
// src/tools.d.ts
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}

// Makes the file a module so the declaration augments (not replaces) package exports.
export {};
```

Export tool refs from `src/index.ts` (`export const searchFruits = …`,
`export const getFruitDetails = …`). Then `useToolContext<"search-fruits">()`,
`useCallTool("get-fruit-details")`, and related hooks infer input/output types
from those refs.

See [Views spec — Typing](../../../specs/VIEWS_SPEC.md#typing-toolref--register-zero-codegen)
for the full contract.

## Result channels

View-bound tool handlers return a plain `CallToolResult` — no response helpers:

1. **`structuredContent`** — model-visible and view-visible structured payload,
   typed by the bound tool's `outputSchema`. In the view it surfaces as
   `toolOutput` when `status === "ready"` (ready requires a non-error result
   with `structuredContent`).
2. **`content`** — model/text-host narrative blocks; also surfaced to the view.
3. **`_meta`** — view-only channel (never model context). The handler passes it
   directly on the returned object; the framework auto-stamps
   `_meta.ui.resourceUri` on every non-error view-bound tool result. There is
   no custom tool-name metadata — each view has one bound tool.

While waiting for a result, branch on `view.status`:

- `"pending"` — no result yet and arguments are not mid-stream (nothing
  arrived, or complete input received and awaiting result); render a static
  skeleton from `view.toolInput` when present.
- `"streaming"` — tool arguments are streaming into `view.toolInput` (a
  `DeepPartial` of the tool input); drive a pulsing skeleton from that field.
- `"cancelled"` — host cancelled the call; `view.reason` is the optional
  host-provided string; `view.toolInput` may still hold the last partial.
- `"error"` — a valid tool error (`instanceof ToolError`) or a malformed
  non-error result (`instanceof InvalidToolResultError`); both expose
  `error.message` for rendering; `toolOutput` is undefined.
- `"ready"` — render from `view.toolOutput` (and optionally `view.content`,
  `view.meta`).

`view.toolInput` is the single streaming field for arguments (partial or
complete; last write wins). Host environment comes from `useHostContext()` /
`useViewTheme()`; actions from `useCallTool`, `useSendFollowUp()`,
`useOpenExternal()`, and `useDisplayMode()`. See
[Views spec — Channel visibility](../../../specs/VIEWS_SPEC.md#channel-visibility-what-the-model-sees-vs-what-the-view-sees).

## Images and CSP

Static files in the project-root `public/` folder are served under
`${basePath}/_mcp-use/public/` (e.g. `/fruits/apple.png` in a view resolves to
`http://127.0.0.1:3000/mcp/_mcp-use/public/fruits/apple.png`). Use the
`<Image>` component for root-relative paths — the
synthesized view document injects the request-resolved public base so URLs stay
absolute inside `srcdoc` iframes (which have no document base URL).

This example keeps fruit PNGs in `public/fruits/` and references them as
`<Image src={`/fruits/${id}.png`} …>`. Same-origin public assets are
automatically covered by the framework's serving-origin CSP entry on view
resources. This example does not declare `view.csp` because it has no external
image or fetch domains. To load assets from another origin, add
`view.csp.resourceDomains` (and `connectDomains` for API calls) on the
bound tool's `view:` config.

Imported assets (Vite `import url from "./file.png"`) are an alternative for
view-local files; production resolves them via `import.meta.url`, and dev
requires the Vite `server.origin` setting so emitted URLs are absolute.

## Tools

| Tool | View | Purpose |
| --- | --- | --- |
| `search-fruits` | `product-search-result` | Search catalog; renders the view when the client supports MCP Apps |
| `get-fruit-details` | — | Called from the view via `useCallTool` for detail cards |

The product-search view also registers `highlight-fruit` via `useViewTool`
(model-initiated UI affordance while the view is mounted).

## Typecheck

```sh
pnpm typecheck
```

Requires a built `@mcp-use/server` (`pnpm build` in `packages/server`) so
`dist/react/index.d.ts` resolves.
