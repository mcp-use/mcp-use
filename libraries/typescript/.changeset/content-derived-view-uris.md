---
"mcp-use": patch
"@mcp-use/cli": patch
---

Keep production view resource URIs stable across deploys. The path is now always `ui://views/<name>.html`, and production adds a `?v=<hash>` cache key derived from each view's built bundle instead of a random per-build ID in the path. Rebuilding identical sources, a backend-only deploy, or another replica keeps the URI; only a view whose JavaScript or CSS changed gets a new `?v=`. Reads ignore the `?v=` value, and the `ui://views/<name>-<build ID>.html` URIs from 2.12 still resolve, so hosts holding an older tool catalog, such as published ChatGPT apps, keep loading the current view instead of getting resource-not-found. On `mixedAuth` servers those URIs are readable signed out like the current one.
