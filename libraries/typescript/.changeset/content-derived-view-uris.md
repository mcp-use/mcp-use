---
"mcp-use": patch
"@mcp-use/cli": patch
---

Derive production view resource URIs from view content instead of a random build ID. Each view's URI hashes its built JavaScript and CSS, its resource metadata (`csp`, `permissions`, `domain`, `prefersBorder`, display modes), and the document template, so rebuilding identical sources, a backend-only deploy, or another replica keeps the URI, and only a changed view gets a new one. Reads of a view's unversioned URI or of a versioned URI from an earlier deployment now return the current view instead of resource-not-found, so hosts holding an older tool catalog, such as published ChatGPT apps, keep loading views. On `mixedAuth` servers those URIs are readable signed out like the current one.
