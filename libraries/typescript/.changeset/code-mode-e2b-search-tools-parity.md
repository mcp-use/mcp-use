---
"@mcp-use/client": minor
---

The E2B code-mode executor's `search_tools()` helper now returns the same `{ meta, results }` envelope as the VM executor and `searchTools()`, matches on the server name as well as the tool name and description, and the exported code-mode agent prompt reads `results` accordingly.
