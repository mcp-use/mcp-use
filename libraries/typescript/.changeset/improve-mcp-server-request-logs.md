---
"mcp-use": patch
---

Improve MCP server request logs: show the JSON-RPC target (tool/resource/prompt name, or client info for initialize) inside the bracket, inline arguments for `tools/call` and `prompts/get`, session id correlation prefix, JSON-RPC error code and message for failed calls, and request duration. The outcome (`OK` / `ERROR <code> <msg>` / `HTTP <code>`) now reflects the actual RPC result instead of just the HTTP status, so failing tool calls no longer appear as `200`.
