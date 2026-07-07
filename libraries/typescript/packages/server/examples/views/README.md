# Views example (Fruit Store)

Reference MCP Apps views server for `@mcp-use/server`. It follows the
[Views spec](../../specs/VIEWS_SPEC.md) fruit-store shape: one view-bound tool,
one view component, typed props via exported tool refs, and the full React
runtime surface (`useView`, `useCallTool`, `useViewTool`, `ModelContext`, and
`Loading`).

## What this demonstrates

- **File-based views** under `resources/<name>/view.tsx`, discovered by
  `mcp-use dev` / `build` / `start`.
- **Tool ↔ view binding** via `view: { name: "product-search-result" }` on
  `search-fruits`, with props typed from the tool's `outputSchema`.
- **Zero-codegen typing** via `src/register.d.ts` and exported tool refs
  (`searchFruits`, `getFruitDetails`).
- **Capability gating** — `search-fruits` returns a markdown table fallback when
  the client does not advertise MCP Apps support.
- **Props flow** — the handler echoes `query` into `structuredContent`; the view
  receives it as React props (not merged from tool input).

## Run locally

From this directory:

```sh
pnpm install   # once, from the monorepo root or here
pnpm dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp` and view assets under
`/_mcp-use/`:

- View document:
  `http://127.0.0.1:3000/mcp/_mcp-use/views/product-search-result.html`
- Built-in inspector (when enabled): linked in the dev server log

Production path:

```sh
pnpm build && pnpm start
```

## Typing (`register.d.ts`)

View bundles never import server code. Types cross in type-space only:

```ts
// src/register.d.ts
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
  }
}

// Makes the file a module so the declaration augments (not replaces) package exports.
export {};
```

Export tool refs from `src/index.ts` (`export const searchFruits = …`). Then
`ViewProps<"search-fruits">`, `LoadingProps<"search-fruits">`, and
`useCallTool("get-fruit-details")` infer input/output types from those refs.

See [Views spec — Typing](../../specs/VIEWS_SPEC.md#typing-toolref--register-zero-codegen)
for the full contract.

## Props model

1. The server handler calls `view({ props, content })` (or returns
   `structuredContent` directly).
2. `props` must match the bound tool's `outputSchema`.
3. The React runtime spreads that payload onto the default export —
   `ViewProps<"search-fruits">` is exactly the output type.

Tool input is available separately via `useView().toolInput` (and streamed
partials feed the optional `Loading` export). See
[Views spec — Props model](../../specs/VIEWS_SPEC.md#props-model).

## Tools

| Tool | View | Purpose |
| --- | --- | --- |
| `search-fruits` | `product-search-result` | Search catalog; renders the view when the client supports MCP Apps |
| `get-fruit-details` | — | Called from the view via `useCallTool` for detail cards |

The view also registers `highlight-fruit` via `useViewTool` (model-initiated UI
affordance while the view is mounted).

## Typecheck

```sh
pnpm typecheck
```

Requires a built `@mcp-use/server` (`pnpm build` in `packages/server`) so
`dist/react/index.d.ts` resolves.
