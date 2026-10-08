---
"mcp-use": minor
---

Add `useHostFile` for reading and guarded editing of the file that opened a ChatGPT desktop View, `useOpenFile` for opening server-provided paths, and request-scoped `ctx.client.resource()` metadata access. Reuse the existing App connection with shared subscriptions and explicit ETag conflict handling.
