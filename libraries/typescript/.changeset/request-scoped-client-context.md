---
"mcp-use": minor
---

Restore the v1-compatible `ctx.client.can()`, `capabilities()`, `info()`, `extension()`, and `user()` helpers using v2 request-scoped metadata. Client capabilities and implementation details come from the modern MCP envelope, while normalized OpenAI caller hints come from ordinary request `_meta`; no metadata is cached across requests or treated as authenticated identity.
