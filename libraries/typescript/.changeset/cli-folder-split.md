---
"@mcp-use/cli": patch
---

Reorganize the CLI source by concern (`bin`, `core`, `build`, `client`, `cloud`) with no change to commands or published entry points, and stop ignoring the retired Vibe `.dev-server-logs.txt` file in the dev server's file watcher.
