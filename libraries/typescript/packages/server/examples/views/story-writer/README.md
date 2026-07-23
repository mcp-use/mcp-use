# Story Writer example

Minimal MCP Apps views server that demonstrates **streaming tool arguments**
into a live view. The model writes a short story into the `write-story` tool's
input (`title`, `story`); the `story-writer` view renders those arguments as
they arrive via `useToolContext<"write-story">()`.

## What this demonstrates

- **Progressive tool input** — partial and complete argument notifications
  replace the pending `toolInput` snapshot (a `DeepPartial`).
- **Default `viewConfig`** — no named export; runtime defaults apply
  (`autoResize: true`, all standard display modes).
- **File-based views** under `views/<name>/view.tsx`, discovered by
  `mcp-use dev` / `build` / `start`.
- **One tool ↔ one view** via `view: { name, description, prefersBorder }` on
  `write-story`.
- **Zero-codegen typing** via `mcp-env.d.ts` and the exported `writeStory`
  tool ref.
- **Tailwind CSS v4** — `vite.config.ts` (`@tailwindcss/vite`) and
  `@import "tailwindcss"` in `view.css`.

## Streaming story input

`write-story` is bound to the `story-writer` view. The model generates the story
**into the tool's input arguments** (`title`, `story`); the handler only returns
a short summary (`title`, `wordCount`). The view uses
`useToolContext<"write-story">()` and branches on `status`:

- `"pending"` — before input, show the waiting state; once `toolInput` exists,
  title and story grow progressively with a caret and “Writing…” indicator.
- `"ready"` — final layout from complete `toolInput` plus `toolOutput.wordCount`
  (ready requires a non-error result with `structuredContent`).
- `"error"` — a `ToolError` with no typed `toolOutput`.

The first structured result or tool error is latched. Content-only ambient
results are ignored and later tool lifecycle notifications cannot replace the
story that rendered the View.

To see it: run `pnpm dev` (`mcp-use dev`), open the inspector chat, and ask for
a short story. The inspector forwards the model's streamed tool arguments to the
view as `ui/notifications/tool-input-partial`, which replaces the pending
`toolInput` snapshot and rerenders the same component.

## Run locally

From this directory:

```sh
pnpm install   # once, from the monorepo root or here
pnpm dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`. Preview the view
through the built-in inspector (linked in the dev server log): open the
`ui://views/story-writer.html` resource via `resources/read`.

Production path:

```sh
pnpm build && pnpm start
```

## Typing (`mcp-env.d.ts`)

```ts
// mcp-env.d.ts
import "mcp-use/vite-client";

declare module "mcp-use/react" {
  interface Register {
    tools: typeof import("./src/index.js");
  }
}

export {};
```

Export the tool ref from `src/index.ts` (`export const writeStory = …`). Then
`useToolContext<"write-story">()` infers input/output types from that ref.

## Typecheck

```sh
pnpm typecheck
```

Requires a built `mcp-use` (`pnpm build` in `packages/server`) so
`dist/react/index.d.ts` resolves.
