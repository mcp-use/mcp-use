---
"@mcp-use/agent": patch
---

Count Anthropic cache tokens in usage totals, and stop `message_delta` erasing the input and cache counters captured at `message_start`. Anthropic reports `cache_read_input_tokens` and `cache_creation_input_tokens` outside `input_tokens` and bills all of them, so a total of input plus output undercounts what the call cost. OpenAI's cached tokens sit inside `prompt_tokens`, so they are left alone.
