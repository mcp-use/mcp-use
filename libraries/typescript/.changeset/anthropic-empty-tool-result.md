---
"@mcp-use/agent": patch
---

fix(agent): send a `[no content]` placeholder instead of an empty string for empty tool results in the Anthropic provider, which the Messages API rejects with `400 tool_result.content: text cannot be empty`
