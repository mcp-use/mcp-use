---
"@mcp-use/cli": patch
"mcp-use": patch
---

Ignore Vibe's managed dev-server log in Vite's file watcher so operational log writes do not trigger endless full reloads instead of view HMR.
