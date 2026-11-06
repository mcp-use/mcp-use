---
"@mcp-use/cli": patch
---

Fix dev-server routing for shared view imports when no landing page exists, and respect configured views directories including `--views-dir` and `--mcp-dir`.

Handle URL-encoded view and shared-module paths consistently, preserve reserved-route exclusions for raw and decoded URLs, and use module-graph routing for views configured at the project root.
