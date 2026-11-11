---
"@mcp-use/client": patch
---

Stop telemetry from reading `globalThis.localStorage` outside the browser. The opt-out and source-hint checks fell back to `localStorage` in every runtime. On Node 25, reading a property of that global prints `Warning: --localstorage-file was provided without a valid path` unless Node runs with `--localstorage-file`, so creating an `MCPClient` printed it. Server runtimes now use only the `MCP_USE_ANONYMIZED_TELEMETRY` and `MCP_USE_TELEMETRY_SOURCE` env vars; browsers keep using `localStorage`.
