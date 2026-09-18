---
"@mcp-use/agent": patch
---

Forward RunOptions.messages in LangChain agent (fixes #2462).

The LangChain agent silently dropped RunOptions.messages because normalizeRunOptions did not propagate the field. The messages are now converted from provider-neutral format to LangChain BaseMessage instances and inserted between externalHistory and the current prompt in both stream() and streamEvents().
