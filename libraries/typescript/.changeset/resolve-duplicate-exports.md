---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Resolved duplicate exports flagged by Knip.

- Annotated the `Tel` alias for `Telemetry` with the `@alias` directive so Knip no longer flags it as a duplicate export. The alias remains available for consumers.
- Unified the canonical source path for `Telemetry`, `Tel`, `setTelemetrySource`, and `isBrowserEnvironment` in `src/telemetry/index.ts`. The Node implementation is now the default and is swapped for the browser implementation in browser bundles via the existing tsup substitution plugin.
- Removed the redundant default export of `JsonRpcLoggerView` in `@mcp-use/inspector`. The named export is unchanged.
