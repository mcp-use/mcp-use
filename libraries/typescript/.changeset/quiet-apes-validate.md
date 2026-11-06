---
"@mcp-use/client": patch
---

`DialectJsonSchemaValidator` now recognises the `https` form of the draft-04 `$schema` URI, so servers that declare `https://json-schema.org/draft-04/schema#` no longer fail with an "unsupported dialect" error.
