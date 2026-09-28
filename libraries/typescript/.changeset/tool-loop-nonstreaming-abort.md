---
"@mcp-use/agent": patch
---

fix(agent): stop dispatching remaining tool calls in a turn once the `signal` is aborted in non-streaming runs (`runToolLoopNonStreaming` and `OpenAIResponsesDriver`), matching the streaming tool loop
