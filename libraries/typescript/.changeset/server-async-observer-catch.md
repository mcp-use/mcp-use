---
"mcp-use": patch
---

fix(server): catch rejected promises from async MCP event listeners

An async `server.on()` observer that rejects no longer produces an unhandled
promise rejection (which can crash the server process). Its rejection is now
caught and logged the same way a synchronous throw already was.
