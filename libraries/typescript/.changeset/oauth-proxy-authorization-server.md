---
"mcp-use": minor
---

Add `oauthProxy()` to `mcp-use/oauth`: the MCP server becomes its own OAuth authorization server in front of an identity provider without dynamic client registration, such as GitHub (`github()`) or Google (`google()`), or any OAuth 2.0 provider (`upstream()`). Clients register (DCR) or present a client ID metadata document, approve a consent page the server owns, and receive the proxy's own opaque tokens. The upstream client secret and tokens stay on the server, encrypted in a shared store (`mcp-use/oauth/storage`: Upstash, Redis, Postgres, Cloudflare D1 or Durable Object, and an in-memory store for local development). Tools read the upstream token with `upstreamToken(ctx)` or `ctx.auth.upstream`.

OAuth providers can now register public HTTP routes from `setup()` with `host.route()`, read the mount mode as `host.mode`, and compute `oauthMetadata` from the resolved resource URL. OAuth endpoints under the MCP path are never written to trace logs, and `oauthEnvironmentValue` no longer throws on runtimes without `process`.
