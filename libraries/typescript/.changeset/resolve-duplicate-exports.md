---
"mcp-use": major
"@mcp-use/inspector": patch
---

Resolved duplicate exports flagged by Knip to ensure a single canonical export path for key symbols.

- Removed the `Tel` alias in favor of the canonical `Telemetry` class in `mcp-use`. This is a breaking change for any users importing `Tel` directly from the package.
- Removed redundant re-exports of `Telemetry` and `setTelemetrySource` from `mcp-use/react` and `mcp-use/browser`. These symbols should now be imported from the root `mcp-use` package. The `BrowserTelemetry` and `setBrowserTelemetrySource` aliases remain available for compatibility.
- Removed the redundant default export of `JsonRpcLoggerView` in `@mcp-use/inspector`.
