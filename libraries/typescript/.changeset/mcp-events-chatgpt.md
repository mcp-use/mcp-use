---
"mcp-use": minor
"@mcp-use/client": minor
"@mcp-use/inspector": minor
"@mcp-use/cli": minor
---

MCP Events: `server.event()` with `emit(data, { eventId })`, served in two dialects chosen per request: ChatGPT's (webhook) and the official `io.modelcontextprotocol/events` extension (webhook and `events/poll`, `notifications/events/list_changed`, `Mcp-Name`/`Mcp-Param-*` validation, SEP error codes). Callback verification, Standard Webhooks signing with retries, memory, file (`mcp-use dev`) and Upstash REST storage (`mcp-use/events`), client poll, subscribe and webhook receiver helpers (`@mcp-use/client/events`) and `useMcpEvent` (`@mcp-use/client/react`), the Inspector Events tab, and `mcp-use client <server> events` and `mcp-use events subscriptions` CLI commands.
