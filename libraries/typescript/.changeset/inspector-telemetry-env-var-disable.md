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

The inspector server now mirrors the env var into a per-page runtime
flag (`window.__MCP_USE_ANONYMIZED_TELEMETRY__`) before the client
bundle runs; both `mcp-use`'s browser telemetry and the inspector's
own client telemetry honor that flag, so a single env var disables
every telemetry path. The flag is page-scoped — it leaves no
persistent state, so unsetting the env var fully restores defaults on
the next page load. Default behavior (telemetry on) is unchanged.
