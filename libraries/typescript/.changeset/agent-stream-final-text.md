---
"@mcp-use/agent": patch
---

`MCPAgent.stream()` now returns, and saves to conversation memory, only the final turn's text, the same as `run()`. Text the model wrote before calling a tool used to be glued onto the answer, for example `Let me check the files.The folder has a.ts.`.
