---
"@mcp-use/agent": patch
---

Reject malformed JSON or non-object function arguments before invoking tools in the native Chat Completions and Responses loops. Stop buffered tool dispatch when a provider emits an error instead of silently substituting empty arguments or executing an incomplete turn. Missing or non-string provider argument fields are also rejected; actual empty strings remain supported for tools with no arguments. Incomplete Chat Completions tool turns now fail explicitly if the stream ends before its finish reason, without dispatching unfinished calls.
