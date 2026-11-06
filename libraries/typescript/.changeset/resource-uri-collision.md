---
"mcp-use": patch
---

`server.resource()` now throws when a different resource name is already registered for the same URI. The server keyed resources by name while the MCP SDK keys them by URI, so two names sharing a URI registered without complaint and then every request, including `initialize`, failed with a 500 "Internal server error" and nothing in the log said why. Registering the same name again still replaces the earlier resource.
