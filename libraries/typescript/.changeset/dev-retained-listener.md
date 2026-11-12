---
"@mcp-use/cli": patch
---

Keep the dev HTTP listener bound throughout startup, including OS-assigned ports requested with `--port 0`. This prevents another process from claiming the selected port while Vite or the application loads. Requests during initialization receive HTTP 503, and failed startup releases the listener.
