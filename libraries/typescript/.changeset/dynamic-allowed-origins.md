---
"mcp-use": minor
---

feat(server): dynamic `allowedOrigins` for multi-domain hosting + Host validation + widget CSP

Extend the existing `allowedOrigins` option from a static `string[]` to `string[] | AllowedOriginsConfig`. A single `OriginResolver` now drives BOTH DNS-rebinding Host validation AND per-request widget `<base>` / asset URLs / CSP, so the same MCP server can serve multiple public domains (Vercel-style previews, canary, custom domains) without redeploying.

- New object form: `{ origins, provider, providerUrl, token, headers, webhookSecret, fallbackRevalidateSeconds }`
- Wildcard hostnames (`https://*.preview.example.com`) — one-label semantics, same as CSP host-source
- Remote `providerUrl` with HTTP cache validators (`Cache-Control` / `ETag` / `If-None-Match` / `stale-while-revalidate`) and single-flight refresh
- HMAC-signed push webhook at `POST /mcp-use/internal/origins/refresh` for instant invalidation (Stripe-style `X-MCP-Signature: t=...,v1=...`, 5-minute replay window)
- New env vars: `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_ORIGINS_URL`, `MCP_ALLOWED_ORIGINS_TOKEN`, `MCP_ALLOWED_ORIGINS_WEBHOOK_SECRET`
- Per-request widget output: `<base>`, `window.__getFile`, `window.__mcpPublicUrl`, and CSP (`connect_domains` / `resource_domains` / `base_uri_domains`) are computed from the allow-list + effective request origin; unknown `Host` falls back to `baseUrl` / `MCP_URL`
- Fail-closed cold start: if providers are configured but the initial fetch fails AND no static origins are set, `/mcp` returns `503 origin allow-list unavailable` until the resolver recovers — no silent bypass of Host validation
- Backward compatible: `allowedOrigins: string[]` keeps today's semantics (hostname-level Host validation, static widget `baseUrl`). Unset `allowedOrigins` is unchanged.
