---
"mcp-use": patch
---

Strip draft-07 `$schema` from tool `inputSchema` and `outputSchema` in `tools/list` responses. The v1 SDK stamps `http://json-schema.org/draft-07/schema#`, which v2 MCP clients reject when compiling output schemas; omitting `$schema` is accepted by both v1 and v2 clients (issue #1839).
