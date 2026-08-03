---
"mcp-use": patch
---

Say what happened to the Inspector on `mcp-use start`. Plain `start` now prints `mcp-use inspector not mounted (dev only by default); pass --with-inspector to serve it here`, so the `404` at `${basePath}/inspector` — advertised by `mcp-use dev` and silently absent in production — no longer reads as a broken build. `mcp-use start --with-inspector` prints the mounted Inspector URL instead of saying nothing at all.
