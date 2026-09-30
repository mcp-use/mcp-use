---
"@mcp-use/agent": patch
---

`runToolLoopNonStreaming` now stops dispatching remaining tool calls in a turn when the `signal` is aborted, matching the cancellation behavior of `runToolLoop`.
