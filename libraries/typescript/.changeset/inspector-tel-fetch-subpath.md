---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Fix embedded inspector failing when `langchain` is not installed: export `telFetch` from `mcp-use/telemetry/tel-fetch` so inspector server code does not load the root `mcp-use` entry (which eagerly pulls the agent graph). Log inspector mount failures in development or when `MCP_USE_DEBUG` is set.
