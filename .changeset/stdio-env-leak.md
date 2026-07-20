---
"mcp-use": patch
---

Stop leaking the full parent process environment to stdio MCP servers. When a server is configured with its own `env`, the connector now layers those variables on top of the SDK's `getDefaultEnvironment()` safe base (`HOME`, `PATH`, ...) instead of copying all of `process.env`, matching the default behaviour of the underlying `@modelcontextprotocol/sdk` transport.
