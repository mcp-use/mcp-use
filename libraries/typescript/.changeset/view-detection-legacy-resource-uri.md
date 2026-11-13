---
"@mcp-use/client": patch
---

`getViewResourceUri()` and `isViewTool()` now also read the deprecated flat `_meta["ui/resourceUri"]` key, so tools from servers that only send that key are detected as MCP Apps views.
