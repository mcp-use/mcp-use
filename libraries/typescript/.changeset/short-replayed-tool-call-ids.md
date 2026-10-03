---
"@mcp-use/agent": patch
---

`convertMessagesToProvider` no longer puts the tool name into the tool call ids it generates for replayed inspector messages, so a long tool name can no longer push the id past OpenAI's 40 character limit and fail the next request.
