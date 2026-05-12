---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Resolved duplicate exports flagged by Knip to ensure a single canonical export path for key symbols.

- Restored the `Tel` alias for telemetry in `mcp-use` to avoid breaking changes and suppress Knip warnings with the `@alias` directive.
- Removed redundant re-exports of `Telemetry` and `setTelemetrySource` from `mcp-use/react` and `mcp-use/browser`. These symbols should now be imported from the root `mcp-use` package. The `BrowserTelemetry` and `setBrowserTelemetrySource` aliases remain available for compatibility.
- Removed the redundant default export of `JsonRpcLoggerView` in `@mcp-use/inspector`.
