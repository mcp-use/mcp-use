# MCP Apps views examples

Sibling examples for MCP Apps views with `@mcp-use/server`:

- [`basic/`](./basic/) — fruit store: default `viewConfig`, `ThemeProvider` /
  `ViewControls`, typed hooks, `useCallTool` error narrowing, `useViewTool`
- [`story-writer/`](./story-writer/) — streaming tool input into a live view
  (default `viewConfig`, error-status handling)
- [`excalidraw/`](./excalidraw/) — port of the original
  [`excalidraw/excalidraw-mcp`](https://github.com/excalidraw/excalidraw-mcp)
  app with `viewConfig.autoResize` / `displayModes`, diagram streaming,
  fullscreen editing, and checkpoints
- [`view-tool-debugger/`](./view-tool-debugger/) — deliberately verbose
  `useViewTool` diagnostic view with raw bridge snapshots, live registration
  controls, latest-closure state tests, success/error/throw paths, and an event
  log
