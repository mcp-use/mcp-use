---
"@mcp-use/client": patch
---

Propagate `tools/list` failures from `initialize()` instead of silently resolving with an empty tool cache. Only `-32601` (method not found) is treated as a server without tools; other server and transport errors now reject initialization.
