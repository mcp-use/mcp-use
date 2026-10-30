---
"@mcp-use/agent": patch
---

Keep MCP prompt arguments optional when their `required` flag is omitted in both the native and LangChain adapters. Only arguments explicitly marked `required: true` are required, so valid prompt calls no longer fail LangChain validation or advertise unnecessary required inputs to native providers.
