---
"@mcp-use/client": patch
---

fix(client): reset tools and server info when useMcp is disabled

When `useMcp` is re-rendered with `enabled: false` (or `url` cleared), it now clears the previous server's `tools`, `resources`, `resourceTemplates`, `prompts`, `skills`, `serverInfo`, `capabilities`, `instructions` and `extensions`, so a disabled hook no longer reports stale data from a server it is no longer connected to.
