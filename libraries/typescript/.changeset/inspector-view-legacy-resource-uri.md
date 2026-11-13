---
"@mcp-use/inspector": patch
---

The Inspector now renders MCP Apps views from tools that only send the deprecated flat `_meta["ui/resourceUri"]` key: chat results, tool execution resource prefetch and MCP Apps capability detection read the same URI as `getViewResourceUri()`.
