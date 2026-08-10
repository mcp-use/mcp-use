# MCP Apps views examples

Sibling examples for MCP Apps views with `mcp-use`:

- [`basic/`](./basic/) — fruit store: default `viewConfig`, `ThemeProvider` /
  `ViewControls`, typed hooks, `useCallTool` error narrowing, `useViewTool`
- [`file-upload/`](./file-upload/) — ChatGPT-only file upload and temporary
  download URLs with `useFiles`
- [`story-writer/`](./story-writer/) — progressive pending tool input into a
  live view (default `viewConfig`, terminal result latch)
- [`view-state/`](./view-state/) — a small product carousel with a
  model-visible cart
- [`property-search/`](./property-search/) — a staged-data San Francisco home
  search with a Zillow-style map/card view, fullscreen mode, app-to-server
  calls, and assistant-controlled map/refinement tools via `useViewTool`
- [`excalidraw/`](./excalidraw/) — port of the original
  [`excalidraw/excalidraw-mcp`](https://github.com/excalidraw/excalidraw-mcp)
  app with `viewConfig.autoResize` / `displayModes`, safe partial parsing until
  the structured result or tool-error latch, fullscreen editing, and checkpoints
