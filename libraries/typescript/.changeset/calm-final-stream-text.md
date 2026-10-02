---
"@mcp-use/agent": patch
---

Make `MCPAgent.stream()` return and persist only the final assistant turn instead of concatenating pre-tool-call text from earlier turns.
