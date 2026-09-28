---
"@mcp-use/agent": patch
---

Fix OpenAI Responses streaming never emitting tool-call args events

`response.function_call_arguments.delta` and `...done` carry `item_id`, not
`call_id`, so the buffer lookup never matched and neither `tool-call-args-delta`
nor `tool-call-ready` was emitted. `MCPAgent.stream()` and `streamEvents()` now
report AgentSteps for tool calls made through the OpenAI Responses provider.
