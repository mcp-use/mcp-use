---
"mcp-use": patch
---

Stop the server's usage telemetry from reading `globalThis.localStorage`. On Node 25 the opt-out check printed `Warning: --localstorage-file was provided without a valid path` on a server's first request. Turn telemetry off with `MCP_USE_ANONYMIZED_TELEMETRY=false`; the server no longer reads that setting from `localStorage`.
