# MCP Apps views examples

Sibling examples for MCP Apps views with `mcp-use`:

- [`basic/`](./basic/) — fruit store: default `viewConfig`, `ThemeProvider` /
  `ViewControls`, typed hooks, `useCallTool` error narrowing, `useViewTool`
- [`file-upload/`](./file-upload/) — ChatGPT-only file upload and temporary
  download URLs with `useFiles`
- [`story-writer/`](./story-writer/) — progressive pending tool input into a
  live view (default `viewConfig`, terminal result latch)
- [`excalidraw/`](./excalidraw/) — port of the original
  [`excalidraw/excalidraw-mcp`](https://github.com/excalidraw/excalidraw-mcp)
  app with `viewConfig.autoResize` / `displayModes`, safe partial parsing until
  the structured result or tool-error latch, fullscreen editing, and checkpoints
