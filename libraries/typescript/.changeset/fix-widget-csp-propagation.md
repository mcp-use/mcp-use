---
"mcp-use": patch
---

Fix widget CSP not propagating to ChatGPT tool metadata

When a widget declared custom CSP domains (e.g. `resourceDomains`, `connectDomains`) in
`widgetMetadata.metadata.csp`, those domains were not reaching ChatGPT's `openai/widgetCSP`
on the tool definition. Two issues were fixed:

- **SSR crash with browser-only imports**: Importing libraries like `leaflet` at module scope
  caused `window is not defined` during Vite SSR metadata extraction, silently dropping all
  widget metadata including CSP. The maps-explorer template now lazy-imports leaflet inside
  `useEffect`. A clearer warning is emitted when SSR metadata extraction fails.

- **Stale `_meta` reference**: When `uiResourceRegistration` updated a tool's `_meta` after
  widget discovery, it replaced the object instead of mutating it in place. The MCP SDK's
  internal `_registeredTools` kept a reference to the old `_meta`, so `tools/list` never
  returned the updated CSP. Now uses `Object.assign` to mutate in place, matching the
  existing HMR sync pattern.
