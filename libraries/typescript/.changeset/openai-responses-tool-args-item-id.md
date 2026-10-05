---
"@mcp-use/agent": patch
---

Fix OpenAI Responses streaming dropping function-call arguments: the provider keyed `function_call_arguments` delta/done events by `call_id`, but the Responses API keys them by `item_id`, so tool-call argument deltas and the final `tool-call-ready` event were never emitted and the Inspector chat drawer showed `{}` for tool call arguments.
