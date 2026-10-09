---
"@mcp-use/agent": patch
---

Fall back to `"[no content]"` when tool result content is an empty string in Anthropic provider, preventing HTTP 400 Bad Request errors from the Anthropic Messages API.
