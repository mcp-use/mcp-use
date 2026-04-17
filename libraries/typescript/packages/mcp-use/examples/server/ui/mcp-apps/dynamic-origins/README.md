# Dynamic origins example

End-to-end demonstration of the `allowedOrigins` object form:

- Static literal + wildcard
- Async `provider` callback
- Remote `providerUrl` with HTTP cache validators
- HMAC-signed push webhook at `POST /mcp-use/internal/origins/refresh`

## Run

```bash
pnpm tsx examples/server/ui/mcp-apps/dynamic-origins/index.ts
```

This starts two HTTP servers:

- MCP server on `http://localhost:3400`
- Mock provider on `http://localhost:3401/origins.json` (serves JSON with
  `Cache-Control: public, max-age=10, stale-while-revalidate=60` and an
  `ETag`)

Watch the mock provider logs for `200 OK` on cold start and `304 Not Modified`
on subsequent revalidations — proof the conditional GET is working.

## What to expect

| Scenario | How | Outcome |
| --- | --- | --- |
| Localhost request | `curl http://localhost:3400/mcp` | Host matches, `<base>` = `http://localhost:3400`, CSP includes everything |
| Wildcard preview | `-H 'Host: pr-42.preview.example.com'` | Host matches the wildcard, `<base>` = `https://pr-42.preview.example.com` |
| Unknown host | `-H 'Host: evil.com'` | 403 from the Host validator — and if the request ever reached the widget reader, CSP would fall back to `baseUrl` |
| Webhook push | `POST /mcp-use/internal/origins/refresh` with valid HMAC + new origins | `204`, new list is applied immediately. Next `resources/read` reflects the change |
| Webhook replay / bad sig | Change `v1=...` or use a timestamp from 10 min ago | `401` |

See the startup banner printed by `index.ts` for copy-pasteable `curl` recipes.
