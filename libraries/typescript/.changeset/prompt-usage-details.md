---
"@mcp-use/agent": patch
---

`tokenUsageFromRecord` now reads the Chat Completions detail names (`prompt_tokens_details` / `completion_tokens_details`) in addition to the Responses API ones, so `cachedInputTokens` and `reasoningTokens` are reported instead of silently dropped for Chat Completions responses.
