---
---

Scaffold `@mcp-use/server` — greenfield v2 server package built on the official
`@modelcontextprotocol/server@2.0.0-beta.1` (stateless 2026-07-28 protocol) and
Hono, with strict type-safety gates and an end-to-end smoke test. Private
during development; no releases from this change. The request context includes
typed form elicitation and progress helpers, and `MCPServer.notify*` publishes
cross-request v2 subscription events.
