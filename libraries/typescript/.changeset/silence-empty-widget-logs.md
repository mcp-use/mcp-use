---
"mcp-use": patch
---

Silence dev-mode widget startup logs when a project has no widgets. An empty or
absent `resources/` directory no longer prints the `[WIDGETS]` mounting/serving/
watching messages. The Vite watcher still starts so widgets created later (e.g.
Mango/E2B sandboxes) are picked up and logged when they appear.
