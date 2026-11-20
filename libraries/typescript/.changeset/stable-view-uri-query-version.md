---
"mcp-use": patch
---

Version production view resource URIs with a `v` query parameter (`ui://views/<name>.html?v=<buildId>`) instead of a path suffix, so the resource path stays stable across builds while each build still gets a fresh host cache key. Reads of `ui://views/<name>.html` and of any single `?v=` value serve the current view, so hosts holding tool metadata from a previous build keep rendering it after a deploy, and `mixedAuth` servers open signed-out reads for every build version of a tool's view.
