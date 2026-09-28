---
"@mcp-use/agent": patch
---

The `RunOptions.messages` docs now state that only the native local agent supports it. The LangChain agent (`@mcp-use/agent/langchain`) ignores `messages`; pass prior messages through `externalHistory` instead.
