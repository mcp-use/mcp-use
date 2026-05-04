---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix(inspector): honor `MCP_USE_ANONYMIZED_TELEMETRY=false` for the
in-browser `useMcp` posthog-js init.

Previously the env var only disabled Node-side telemetry and the
inspector's server-side proxy. The `useMcp` React hook still
initialized `posthog-js` directly in the browser, sending events to
`https://eu.i.posthog.com` that ad/tracker blockers would flag.

The inspector server now mirrors the env var into a runtime flag
(`window.__MCP_USE_ANONYMIZED_TELEMETRY__`) and `localStorage` before
the client bundle runs; both `mcp-use`'s browser telemetry and the
inspector's own client telemetry honor that flag, so a single env var
disables every telemetry path. Default behavior (telemetry on) is
unchanged.
