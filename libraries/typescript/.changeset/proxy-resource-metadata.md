---
"mcp-use": patch
---

Fix proxied resources losing their `annotations` and `_meta`. `ResourceDefinition` carries both and the local registration path preserves them, but the proxy mount copied only `title`, `description` and `mimeType`, so composing an upstream server through `use()` stripped its client hints and extension metadata from `resources/list`.
