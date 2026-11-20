---
"mcp-use": patch
"@mcp-use/cli": patch
---

Keep production view resource URIs stable across deploys. The path is now always `ui://views/<name>.html`, and production adds a `?v=<hash>` cache key derived from each view's built bundle and the settings declared on its tool's `view` (`csp`, `permissions`, `domain`, `prefersBorder`) instead of a random per-build ID in the path. Rebuilding identical sources, a backend-only deploy, or another replica keeps the URI; only a view whose JavaScript, CSS, or one of those settings changed gets a new `?v=`. Reads ignore the `?v=` value, and the `ui://views/<name>-<build ID>.html` URIs from 2.12 still resolve, so a host that reads a URI from an older tool catalog, such as a published ChatGPT app, gets the current view instead of resource-not-found. On `mixedAuth` servers those URIs of tool-bound views are readable signed out like the current one; unbound views stay gated.
