---
"@mcp-use/client": patch
---

Stop telemetry from reading `globalThis.localStorage` outside the browser. The opt-out and source-hint checks fell back to `localStorage` in every runtime, and on Node 25 any read of that global, `typeof` included, prints a warning unless Node runs with `--localstorage-file`. Server runtimes now use only the `MCP_USE_ANONYMIZED_TELEMETRY` and `MCP_USE_TELEMETRY_SOURCE` env vars; browsers keep using `localStorage`.
