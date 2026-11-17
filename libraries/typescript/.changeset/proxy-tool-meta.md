---
"mcp-use": patch
---

Forward upstream tool `_meta` through `server.proxy()`. The proxy already re-advertises `_meta` for proxied resources, but dropped it for tools, so extension metadata a composed server published on `tools/list` disappeared the moment it was mounted behind a proxy. Framework-owned MCP Apps keys are unaffected: `buildToolUiMeta` still derives `ui.resourceUri` and `ui.visibility` from the local definition and strips any inherited copies, so a proxied tool cannot advertise an upstream view URI that does not resolve on the proxy.
