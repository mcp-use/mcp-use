# Excalidraw example

Port of [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) to
`@mcp-use/server` MCP Apps views. Streams hand-drawn diagrams into a live view
with camera animation, pencil stroke audio, fullscreen editing, checkpoints, and
export to excalidraw.com.

## What this demonstrates

- **Streaming tool input** — `create_view` streams an `elements` JSON string;
  the view parses partial JSON and morphdom-diffs SVG via `exportToSvg`.
- **View-bound tool** — `view: { name: "excalidraw", prefersBorder, csp, permissions }`
  on `create_view`.
- **App-private tools** — `export_to_excalidraw`, `save_checkpoint`, and
  `read_checkpoint` use `visibility: "app"` and are called from the view via
  `useCallTool`.
- **Model context** — `<ModelContext>` plus imperative `modelContext.set` for
  user edit summaries from fullscreen.
- **External assets CSP** — Excalidraw CSS/fonts load from `https://esm.sh`
  via `view.csp`.

## Tools

| Tool | Visibility | Purpose |
| --- | --- | --- |
| `read_me` | model | Element format cheat sheet (call before drawing) |
| `create_view` | model + view | Stream/render diagram; returns `checkpointId` |
| `export_to_excalidraw` | app | Upload encrypted scene to excalidraw.com |
| `save_checkpoint` | app | Persist fullscreen user edits |
| `read_checkpoint` | app | Restore checkpoint base while streaming |

## Run locally

From this directory (after installing workspace deps from the TypeScript
monorepo root):

```sh
pnpm install
pnpm dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`.

```sh
pnpm build && pnpm start
pnpm typecheck
```

## Source

Faithful port of user-visible behavior from
[excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp).
Server transport/registration uses `@mcp-use/server`; the Excalidraw UI, SVG
streaming pipeline, sounds, and checkpoint logic are retained.
