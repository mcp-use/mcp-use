---
"@mcp-use/inspector": patch
"@mcp-use/client": patch
"@mcp-use/agent": patch
---

Stream partial tool-call arguments into the Inspector drawer and MCP App view while the model is generating them. Anthropic tool requests now opt into eager input streaming, partial JSON healing handles code and SVG strings correctly, hosted chat accepts tool-call start/delta frames, and the view host no longer overwrites newer partial input with a stale complete-input notification.
