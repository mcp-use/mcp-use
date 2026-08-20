---
"@mcp-use/inspector": patch
---

Keep `cacheCreationInputTokens` visible in the inspector: it now survives aggregation, the LLM span usage, and the aggregate `tokenUsage` written to the raw-chat payload. The token total also no longer double-counts OpenAI cache reads. The fallback total adds only the Anthropic-shaped `cache_read_input_tokens`, since OpenAI's cached tokens are already inside `inputTokens`.
