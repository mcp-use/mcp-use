---
"mcp-use": patch
---

Link loopback servers to their own Inspector from the landing page. The hosted Inspector cannot reach `localhost` (the dev server refuses its CORS preflight), so the first "Open in Inspector" click on a freshly scaffolded project failed with a 403; a server on `localhost`, `127.0.0.1`, `[::1]` or `*.localhost` now links to its own `<mcp url>/inspector` mount instead.
