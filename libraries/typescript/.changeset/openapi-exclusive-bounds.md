---
"mcp-use": patch
---

Convert OpenAPI 3.0 boolean `exclusiveMinimum` and `exclusiveMaximum` into JSON Schema numeric bounds so `MCPServer.fromOpenAPI` accepts specs that use them instead of throwing while registering tools.
