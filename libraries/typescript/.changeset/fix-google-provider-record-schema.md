---
"mcp-use": patch
---

Fix Google provider rejecting tool schemas with `propertyNames` keyword.

`z.record()` causes `@langchain/core` to emit a `propertyNames` field in the JSON Schema output for constrained or enum key types, which Google's Generative AI API rejects. Switching to `z.object({}).catchall()` produces identical runtime behavior while serializing cleanly without `propertyNames`.
