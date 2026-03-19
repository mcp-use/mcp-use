---
"mcp-use": patch
"@mcp-use/inspector": patch
---

fix: map elicit result `content` to `data` for Zod validation

The MCP SDK returns form data in `result.content` per the elicitation spec, but
`createElicitMethod` was checking `result.data` which is always undefined from
spec-compliant clients. This caused Zod validation to never run, leaving
`result.data` as undefined for tool callbacks using `ctx.elicit()` with a Zod
schema.

Now reads `result.content` (with fallback to `result.data` for backward
compatibility) and always maps accepted form data to `result.data` so the typed
API works correctly. Also fixes the inspector to send `content` instead of
`data` per the MCP spec.
