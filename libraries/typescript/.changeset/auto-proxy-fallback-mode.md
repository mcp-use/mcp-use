---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix(inspector): default connections to Auto mode with proxy fallback

The Inspector connection form no longer asks users to choose between Direct and
Via Proxy before connecting. New connections use Auto mode by default: the
Inspector tries a direct browser connection first, then falls back to the
configured Inspector proxy when direct connection fails because of CORS or other
proxy-resolvable connection errors.

Direct and Proxy are still available as advanced connection mode overrides in
the Configuration dialog, alongside the editable Proxy Endpoint. The Inspector
also preserves legacy `connectionType` configs while writing the new
`connectionMode` field.

`useMcp` now applies the runtime proxy config after automatic fallback when it
derives gateway URLs and headers, so fallback retries route through the proxy
instead of continuing to use the original direct transport config.
