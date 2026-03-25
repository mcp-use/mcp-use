---
"@mcp-use/inspector": patch
---

Preserve tool call results (including `structuredContent`) in Inspector chat history across conversation turns

Previously, `convertMessagesToLangChain` only emitted `HumanMessage` and `AIMessage`, dropping all tool invocation data when reconstructing conversation history. This meant the model lost context about previous tool calls and their results on subsequent turns.

Now, assistant messages with tool-invocation parts are properly reconstructed as an `AIMessage` with `tool_calls` followed by `ToolMessage` objects for each completed invocation. The `_meta` field is stripped from tool results before they reach the model, while `structuredContent` and all other fields are preserved.
