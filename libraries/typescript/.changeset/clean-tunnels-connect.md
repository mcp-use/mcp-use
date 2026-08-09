---
"@mcp-use/tunnel": minor
"@mcp-use/cli": patch
"mcp-use": patch
---

Publish the authenticated WebSocket tunnel client as a standalone package and
bundle the same implementation into `mcp-use dev/start --tunnel`. This removes
native tunnel binaries and adds bounded HTTP, streaming, MCP JSON-RPC, and
public WebSocket forwarding without adding a runtime dependency to `mcp-use`.
