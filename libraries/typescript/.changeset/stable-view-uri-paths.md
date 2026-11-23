---
"mcp-use": patch
---

Keep production view resource paths stable across deploys. The path is now always `ui://views/<name>.html`, and production sends the build ID as a `?v=<build ID>` cache key instead of putting it in the path. Reads ignore the `?v=` value, and the `ui://views/<name>-<build ID>.html` URIs from 2.12 still resolve, so a host that reads a URI from an older tool catalog, such as a published ChatGPT app, gets the current view instead of resource-not-found. On `mixedAuth` servers those URIs of tool-bound views are readable signed out like the current one; unbound views stay gated.
