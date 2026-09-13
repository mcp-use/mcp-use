---
"@mcp-use/client": minor
"@mcp-use/agent": patch
---

Initialize connectors on demand again when loading agent tools, resources and prompts.

The adapter decided whether a connector needed initializing by reading `connector.tools`, which throws before `initialize()` has run and after `disconnect()` clears the cached list. The on-demand initialization path therefore threw instead of taking itself, and callers that catch the failure drop the server. `BaseConnector` now exposes `isInitialized`, which answers the same question without throwing.
