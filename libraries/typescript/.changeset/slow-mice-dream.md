---
"@mcp-use/cli": patch
---

Fix `mcp-use dev` occasionally failing to bind its resolved port: `resolvePort` confirms a port is free by binding and immediately releasing a throwaway probe server, but the entry import and Vite setup that run before the real bind (the port has to be committed early so entry-module code can read it via `process.env.PORT`) leave enough time for another transient prober — a concurrent `resolvePort` call, a test's own free-port check — to grab and release that exact port in between, crashing the real bind with an unhandled `EADDRINUSE`. The real bind now retries the same port a few times before giving up, riding out that transient hold instead of crashing on it.
