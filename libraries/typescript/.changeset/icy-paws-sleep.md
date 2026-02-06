---
"mcp-use": minor
---

Added support for resource template variable completion: resource templates can define callbacks.complete per variable (either a string array or a callback), which is normalized and passed to the SDK so clients can use autocomplete for URI template variables. Includes toResourceTemplateCompleteCallbacks, unit tests, and documentation updates.

Also publishes completion capabilities in TypeScript SDK MCP servers.
