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
- **In-place model edits** — the mounted view registers `edit_drawing` with
  `useViewTool`. Structured create/update/move/delete/replace operations apply
  to the current scene, update the same checkpoint, and keep the same iframe
  and canvas mounted.
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
| `edit_drawing` | model (view tool) | Edit the currently mounted canvas in place |
| `export_to_excalidraw` | app | Upload encrypted scene to excalidraw.com |
| `save_checkpoint` | app | Persist fullscreen user edits |
| `read_checkpoint` | app | Restore checkpoint base while streaming |

## Create, then refine the same canvas

Start with a prompt that creates the initial view:

> Draw a three-step checkout flow in Excalidraw.

Once it is visible, refinements should use the canvas's `edit_drawing` view
tool rather than calling `create_view` again:

> On this same canvas, move the payment step 80px to the right, make it light
> yellow, and add a red "Payment failed" branch.

> Keep this drawing open and rename the selected box to "Fraud review".

The edit tool accepts up to 100 sequential operations per call. Each operation
can create shorthand elements, update safe visual/geometry fields, move targets
by a delta, delete targets, or replace targets. Targets use the stable IDs from
the initial drawing and can also include the user's current fullscreen
selection with `selected: true`. A successful call saves the complete updated
scene under the original checkpoint before it reports success.

## Run locally

From this directory:

```sh
npm install
npm run dev
```

`mcp-use dev` serves MCP at `http://127.0.0.1:3000/mcp`. Preview the view
through the built-in inspector: open `ui://views/excalidraw.html` via
`resources/read`.

```sh
npm run build && npm start
npm run typecheck
```

## Source

Faithful port of user-visible behavior from
[excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp).
Server transport/registration uses `mcp-use`; the Excalidraw UI, SVG
streaming pipeline, sounds, and checkpoint logic are retained.
