---
"@mcp-use/agent": patch
---

Fix OpenRouter BYOK requests to OpenAI models returning neither a model response nor an actionable provider error by routing those models through the Responses API.
