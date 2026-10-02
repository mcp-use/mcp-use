---
"@mcp-use/agent": patch
---

Normalize `system` and `assistant` message content in OpenAI providers (`openai-chat-completions` and `openai-responses`) when `ProviderMessage` content is supplied as `ContentPart[]` or empty assistant text without tool calls.
