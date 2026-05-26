---
"@mcp-use/cli": minor
"@mcp-use/inspector": minor
---

`mcp-use client screenshot` now auto-sizes screenshots to the widget's natural rendered dimensions when `--width`/`--height` are omitted, eliminating excess whitespace. Fixes screenshotting against external MCP servers (e.g. Excalidraw) — URIs like `ui://excalidraw/mcp-app.html` were breaking the preview route; they are now correctly handled as `<server>-<name>`.
