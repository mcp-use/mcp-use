# Story Writer example

Minimal MCP Apps views server that demonstrates **streaming tool arguments**
into a live view. The model writes a short story into the `write-story` tool's
input (`title`, `story`); the `story-writer` view renders those arguments as
they arrive via `useToolContext<"write-story">()`.

## What this demonstrates

- **Streaming tool input** — arguments land in `toolInput` (a `DeepPartial`)
  while `status === "streaming"`, including the `"cancelled"` and `"error"`
  branches.
- **Default `viewConfig`** — no named export; runtime defaults apply
  (`autoResize: true`, all standard display modes).
- **File-based views** under `resources/<name>/view.tsx`, discovered by
  `mcp-use dev` / `build` / `start`.
- **One tool ↔ one view** via `view: { name, description, prefersBorder }` on
  `write-story`.
- **Zero-codegen typing** via `src/tools.d.ts` and the exported `writeStory`
  tool ref.
- **Tailwind CSS v4** — `vite.config.ts` (`@tailwindcss/vite`) and
  `@import "tailwindcss"` in `view.css`.

## Streaming story input

`write-story` is bound to the `story-writer` view. The model generates the story
**into the tool's input arguments** (`title`, `story`); the handler only returns
a short summary (`title`, `wordCount`). The view uses
`useToolContext<"write-story">()` and branches on `status`:

- `"streaming"` — progressive `toolInput` (a `DeepPartial`); title and story
  grow as tokens arrive; the UI shows a caret and a "Writing…" indicator.
- `"pending"` — waiting to start, or complete input received and awaiting the
  tool result ("Finishing…").
- `"ready"` — final layout from complete `toolInput` plus `toolOutput.wordCount`
  (ready requires a non-error result with `structuredContent`).
- `"cancelled"` — dimmed partial story plus `reason` when the host cancels.
- `"error"` — tool failure (`error.kind === "tool"`) or malformed non-error
  result (`error.kind === "invalid-result"`); no typed `toolOutput`.

To see it: run `pnpm dev` (`mcp-use dev`), open the inspector chat, and ask for
a short story. The inspector forwards the model's streamed tool arguments to the
view as `ui/notifications/tool-input-partial`, which drives
`status === "streaming"`.

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

## Typing (`tools.d.ts`)

```ts
// src/tools.d.ts
declare module "@mcp-use/server/react" {
  interface Register {
    tools: typeof import("./index.js");
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

Requires a built `@mcp-use/server` (`pnpm build` in `packages/server`) so
`dist/react/index.d.ts` resolves.
