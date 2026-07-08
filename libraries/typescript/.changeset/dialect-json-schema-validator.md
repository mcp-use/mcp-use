---
"@mcp-use/client": patch
---

Default `jsonSchemaValidator` (`DialectJsonSchemaValidator`) now accepts JSON Schema draft-04/-07/2019-09 dialects emitted by v1-era servers, fixing `InvalidParams` on `callTool` for tools with `outputSchema` (issue #1839).
