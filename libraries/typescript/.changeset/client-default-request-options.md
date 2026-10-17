---
"@mcp-use/client": patch
---

fix(client): `defaultRequestOptions` is now applied to every request the connector issues (`callTool`, `listTools`, `listResources`, `listResourceTemplates`, `readResource`, `subscribeToResource`, `unsubscribeFromResource`, `listPrompts`, `getPrompt`, `complete`, `request`), not just the initial `tools/list`. Per-call options are merged on top and take precedence. `listPrompts` now accepts per-call request options.
