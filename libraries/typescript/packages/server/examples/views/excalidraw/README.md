# Excalidraw example

Port of [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) to
`mcp-use` MCP Apps views. Streams hand-drawn diagrams into a live view
with camera animation, pencil stroke audio, fullscreen editing, checkpoints, and
export to excalidraw.com.

## What this demonstrates

- **Streaming tool input** — `create_view` streams an `elements` JSON string;
  the view parses partial JSON and morphdom-diffs SVG via `exportToSvg`.
- **Manual resize + display modes** — `viewConfig` sets `autoResize: false`
  (fixed 4:3 SVG preview) and `displayModes: ["inline", "fullscreen"]`.
- **View-bound tool** — `view: { name: "excalidraw", prefersBorder, csp, permissions }`
  on `create_view` (one tool per view).
- **App-private tools** — `export_to_excalidraw`, `save_checkpoint`, and
  `read_checkpoint` use `visibility: "app"` and are called from the view via
  `useCallTool`. They declare no `outputSchema`, so their successes are
  content-only results — `callTool` resolves them and the view reads
  `result.content`; tool errors and transport failures reject.
- **Latched tool lifecycle** — every pending `toolInput` update is treated as
  progressive; only the first structured result finalizes the diagram and
  checkpoint. `create_view` can return `isError: true` for oversized or
  invalid JSON.
- **Model context** — `<ModelContext>` plus imperative `modelContext.set` for
  user edit summaries from fullscreen.
- **External assets CSP** — Excalidraw CSS/fonts load from `https://esm.sh`
  via `view.csp`.

The pending input snapshot does not distinguish partial from complete
notifications, so the View keeps using its partial-JSON parser until
`useToolContext` becomes `ready` or `error`. After that terminal latch,
content-only lifecycle results from checkpoint/export helper tools cannot
replace the diagram or checkpoint id.

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

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`. Preview the view
through the built-in inspector: open `ui://views/excalidraw.html` via
`resources/read`.

```sh
pnpm build && pnpm start
pnpm typecheck
```

## Source

Faithful port of user-visible behavior from
[excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp).
Server transport/registration uses `mcp-use`; the Excalidraw UI, SVG
streaming pipeline, sounds, and checkpoint logic are retained.
