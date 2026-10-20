---
"@mcp-use/inspector": patch
---

Strip DevSpace routing headers before forwarding MCP requests so the Inspector proxy can reach hosted MCP servers without routing them using the Inspector's hostname.
