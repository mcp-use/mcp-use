---
"mcp-use": patch
---

Fix `ThemeProvider` remounting the view when the display mode switches between inline and fullscreen/pip. The wrapper is now always a `<div>` (`display: contents` inline), so local state and `useCallTool` results survive display mode changes (#2640).
