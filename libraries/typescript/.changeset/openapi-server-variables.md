---
"mcp-use": patch
---

`MCPServer.fromOpenAPI` now fills `{variable}` placeholders in `spec.servers[0].url` with their declared defaults, so specs that template the scheme, host or version no longer fail every tool call with "Invalid URL". A relative server URL such as `/api/v3` now throws when the server is created, with a message pointing at `options.baseUrl`, instead of failing each call.
