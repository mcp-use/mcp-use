# Localhost and hosted Inspector MCP compatibility report

Audit date: 2026-07-21
Browser origin tested: `http://localhost:8080`
Hosted-origin follow-up: ephemeral `https://*.trycloudflare.com` Inspector

## Executive summary

Four of the five popular third-party servers tested cannot complete the entire MCP + OAuth flow directly from a browser-hosted localhost Inspector. Each fails at a different HTTP boundary:

- Linear: MCP and authorization-server endpoints allow localhost, but protected-resource metadata does not.
- PostHog: the MCP endpoint and authorization-server endpoints do not allow localhost.
- Supabase: the MCP, protected-resource, authorization metadata, token, and registration responses omit `Access-Control-Allow-Origin` for localhost.
- Vercel: OAuth discovery and token/registration preflights allow browsers, but the MCP endpoint does not.
- Omnilex: OAuth discovery and public-client registration are browser-compatible, but its MCP preflight does not allow the `MCP-Protocol-Version` header used by current clients. The hosted relay succeeds.

This means an Inspector proxy cannot cover only the MCP transport. The same relay-backed `fetch` must be used for MCP requests, protected-resource discovery, authorization-server discovery, dynamic client registration, token exchange, token refresh, and revocation. Top-level navigation to the authorization endpoint should remain direct.

The Manufact-hosted inventory is healthier. Of 30 verified domains whose server and active deployment are both marked `running`:

- 23 are browser-direct compatible at the CORS, initialize, and OAuth-discovery/preflight level.
- 1 has a usable MCP endpoint but needs a relay for its authorization-server metadata and token/registration endpoints.
- 2 have reachable MCP endpoints but currently broken protected-resource metadata upstream (`522` and `530`).
- 4 fail before MCP initialization because of DNS/TLS, platform `522`, or WAF `403` responses.

The inventory-wide audit below did not create OAuth clients or perform interactive login. Later authenticated follow-ups used the implemented relay and the Inspector's own identity from localhost and from a public HTTPS tunnel; those results are recorded separately below. Linear and PostHog work from both origins. Supabase works after adding server-side confidential-client handling to the OAuth BFF. Vercel rejects dynamic registration for an arbitrary public tunnel redirect URI, but works from the same hosted Inspector when the operator manually registers the Inspector's public client and exact callback URL.

## Method

For each MCP URL or candidate path, the audit sent:

1. An `OPTIONS` preflight containing the headers used by Streamable HTTP MCP.
2. A `POST initialize` using MCP protocol version `2025-06-18`.
3. For protected servers, a browser-origin `GET` of the `resource_metadata` URL from `WWW-Authenticate`.
4. A browser-origin `GET` of OAuth authorization-server metadata.
5. Non-mutating `OPTIONS` preflights to advertised token and dynamic registration endpoints.

The audit did not submit registrations, exchange authorization codes, persist credentials, or call tools.

## Popular public MCP servers

| Server | Canonical MCP endpoint | MCP CORS from localhost | OAuth browser chain | Direct localhost result | Relay coverage needed |
| --- | --- | --- | --- | --- | --- |
| Linear | `https://mcp.linear.app/mcp` | Pass: `204`, exact localhost origin | Protected-resource metadata has no CORS; authorization metadata and token/registration preflights pass | Fails | Protected-resource discovery; using the relay for the whole connection is simpler |
| PostHog | `https://mcp.posthog.com/mcp` | Fail: `401` without CORS | Protected-resource metadata passes, but authorization metadata and token/registration preflights do not | Fails | MCP transport plus OAuth discovery/token/registration |
| Supabase | `https://mcp.supabase.com/mcp` | Fail: preflight omits ACAO | Protected-resource metadata, authorization metadata, token, and registration omit ACAO; the authorization server advertises only confidential client authentication | Fails direct; hosted BFF succeeds | Entire MCP/OAuth fetch chain plus server-side DCR secret custody and token client authentication |
| Vercel | `https://mcp.vercel.com` | Fail: MCP responses omit ACAO | Protected-resource and authorization metadata use wildcard CORS; token/registration preflights pass | Fails direct; relay succeeds with localhost DCR or a manually registered hosted public client | MCP transport plus an operator-owned hosted OAuth client and exact callback |
| Omnilex | `https://api.omnilex.ai/mcp` | Partial: exact localhost origin is allowed, but the preflight omits `MCP-Protocol-Version` | Protected-resource and authorization metadata allow localhost; the server advertises PKCE, DCR, and public client authentication | Fails current browser-direct transport; hosted relay succeeds | MCP transport; the OAuth chain works as a normal public PKCE client |

Additional observations:

- Vercel's canonical endpoint is the origin root. `https://mcp.vercel.com/mcp` returned `404`.
- Vercel's live authorization server accepted standards-compliant public DCR for `mcp-use Inspector` with a localhost redirect, displayed the normal Vercel consent screen, and completed authorization without impersonating another client. The same DCR request with a temporary public `*.trycloudflare.com` callback was rejected with `invalid_redirect_uri`.
- PostHog's legacy `/sse` path redirects to `/mcp?_deprecated=sse`.
- Linear is a useful regression test because proxying only the MCP endpoint appears to work until the SDK fetches protected-resource metadata.
- Supabase is the strongest test for a complete relay because every browser-fetched part of the flow needs coverage.

Official endpoint documentation:

- [Linear MCP](https://linear.app/docs/mcp)
- [PostHog MCP](https://posthog.com/docs/model-context-protocol)
- [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp)
- [Vercel MCP](https://vercel.com/docs/agent-resources/vercel-mcp)

### Authenticated relay follow-up

The implemented fetch-native relay was tested interactively from `http://localhost:8080`:

| Server | Authenticated result |
| --- | --- |
| Linear | Public DCR, consent, callback, token exchange, initialization, and discovery succeeded; 62 tools loaded. |
| PostHog | Public DCR and EU Cloud consent succeeded. The connection remained healthy after treating unsupported `resources/templates/list` as a non-fatal optional inventory error. |
| Supabase | Supabase issued a confidential DCR client. The OAuth BFF retained its secret server-side, returned a browser-safe client record, and restored `client_secret_basic` or `client_secret_post` only at bound OAuth endpoints. Consent, token exchange, initialization, and inventory succeeded; 29 tools loaded. |
| Vercel | Public DCR and consent succeeded under the Inspector's own identity. Access was scoped to the Manufact `mcp-use-cloud` project; 30 tools and 13 prompts loaded. |

### Public HTTPS tunnel follow-up

The locally built Inspector was exposed through Cloudflare Quick Tunnels to emulate a hosted deployment. The application used an explicit public `MCP_URL`, and the local Inspector bundle was served through a second HTTPS tunnel with preview CORS enabled. The tested application hostname was ephemeral and is not a permanent deployment URL.

The first hosted preflight exposed a reverse-proxy origin bug: the relay compared the browser's public HTTPS `Origin` to Node's internal `http://localhost:8080` request URL. The relay now resolves its expected origin through the server's existing deployment-aware origin resolver: explicit `MCP_URL` first, trusted forwarded headers second, and the request URL as the direct-server fallback. Regression tests cover both explicit and forwarded public origins.

| Server | Public-origin result |
| --- | --- |
| Local basic server | Auto-connect, initialize, discovery, and inventory succeeded through the public hostname; 1 tool loaded. |
| Linear | Public DCR, both consent stages, tunneled callback, token exchange, initialization, and inventory succeeded; 62 tools loaded. |
| PostHog | Public DCR, EU Cloud selection, consent, tunneled callback, token exchange, initialization, and inventory succeeded; 1 aggregated tool and 173 resources loaded. |
| Supabase | Public DCR, consent, callback, confidential token exchange through the BFF, initialization, and inventory succeeded; 29 tools loaded. The client secret was never returned to or persisted by the browser. |
| Vercel | DCR returned `400 invalid_redirect_uri` for the temporary public callback. A manually registered `mcp-use Inspector` public client using authentication method `none`, the exact tunneled callback, and `openid offline_access` then completed consent, token exchange, MCP initialization, and inventory; 30 tools and 13 prompts loaded. |
| Omnilex | Public DCR/PKCE, authorization, callback, token exchange, initialization, and inventory succeeded; 11 tools loaded. The read-only `get_catalog` tool also executed successfully through the public hostname in 2.3 seconds. |

#### Manufact dashboard connection regressions

The production Supabase inventory was queried read-only for the exact connection URLs used by Cloud. These tests exercise the same mcp-use client plus Inspector relay path used by the dashboard; they do not bypass the relay with direct browser fetches.

| Cloud server | Production URL | Public-origin result |
| --- | --- | --- |
| PredictLeads | `https://mcp.predictleads.com/` | Two production external-server rows resolve to the same URL. Public DCR, consent, callback, token exchange, initialization, and inventory succeeded; 32 tools loaded. |
| Prompting Company (`tpc`) | `https://mcp.promptingco.com/mcp` | MCP relay, bearer challenge, protected-resource metadata, and authorization metadata succeeded. DCR failed with `400 invalid_redirect_uri` for the temporary hosted callback. The localhost Inspector completed DCR and reached Prompting Company's account onboarding; the test account then required starting a paid trial before consent could complete. The hosted error tile now recommends the exact local CLI command. |
| Atlas | `https://mcp.atlaswork.ai/mcp` | The running hosted server and external-server record resolve to the same URL. Public DCR, consent, callback, token exchange, initialization, and inventory succeeded; 11 tools and 3 resources loaded. |

Prompting Company's authorization server publishes two metadata documents for its pathful issuer. `/.well-known/oauth-authorization-server/api/auth` advertises `/oauth/*` endpoints, while `/api/auth/.well-known/oauth-authorization-server` advertises `/api/auth/oauth2/*` endpoints. The client correctly chooses the RFC 8414 path-inserted form first, but the divergent documents should be consolidated to avoid host-specific discovery differences.

The PredictLeads consent page displayed a raw subscription authentication key. The Inspector does not need or consume that value. Treat displaying it during OAuth consent as a credential-exposure risk and rotate the key if browser recordings or automation output may have retained it.

Cloudflare documents Quick Tunnels as a development/testing facility and does not support SSE on them. This pass verifies Streamable HTTP requests, OAuth redirects, token exchange, and inventory calls, but it is not sufficient certification for long-lived SSE/subscription behavior. Use a named tunnel or the real hosted edge for that regression.

### Host compatibility profiles

The Inspector can safely reproduce how ChatGPT, Claude, Codex, or another host speaks MCP without claiming to be that product. A profile may configure:

- protocol version and negotiation behavior;
- advertised MCP client capabilities and extensions;
- transport headers, streaming behavior, timeouts, and optional-method tolerance;
- the tool, resource, prompt, sampling, elicitation, and MCP Apps surfaces enabled by that host.

OAuth identity must remain `mcp-use Inspector` (or another operator-owned registered client). Profiles must not copy another product's OAuth client ID, secret, registered redirect URIs, or verified branding. Localhost Vercel proves that the Inspector's own identity works; hosted Vercel additionally requires approval for the Inspector's stable public callback. Impersonation is neither necessary nor an acceptable workaround.

### Hosted OAuth coverage design

A browser Inspector cannot unilaterally make every OAuth server accept an arbitrary callback hostname. The authorization server owns its client and redirect policy. The hosted product should support four explicit tiers:

1. **Public DCR:** use the Inspector's current browser PKCE flow through the relay. Linear, PostHog, PredictLeads, and Atlas pass this tier.
2. **Redirect-allowlisted public hosting:** use an operator-owned `mcp-use Inspector` public client with one stable callback such as `https://inspector.mcp-use.com/oauth/callback`, or fall back to the local companion described below. This path was validated with a manually registered Vercel App against the temporary tunnel. Prompting Company still needs its own manual registration, approved callback, or the loopback fallback.
3. **Confidential clients:** keep DCR client secrets in the server-side BFF/vault and inject them only at OAuth endpoints bound through validated discovery. The browser receives the public client ID and tokens but never the client secret. Supabase validates this tier with both `client_secret_basic` and `client_secret_post` support.
4. **No DCR or enterprise policy:** let the server operator supply a client registration to the BFF, or document that upstream approval, private networking, mTLS, or an IP allowlist is required. A relay cannot override those upstream controls.

For a single canonical hosted Inspector, the stable callback can land directly on that application. To support arbitrary self-hosted Inspector origins, use a managed callback broker on the stable mcp-use domain:

1. The originating Inspector creates a short-lived broker session containing an allowlisted return origin, MCP server identity, OAuth client registration, and PKCE challenge.
2. The authorization server redirects only to the stable broker callback.
3. The broker validates one-time state and returns the authorization result to the originating Inspector without putting tokens in the URL.
4. Token exchange, refresh, revocation, and confidential client authentication run through the BFF. The browser uses an opaque connection/session handle.

Add an on-demand local companion for servers that reject arbitrary public redirects, require loopback callbacks, expose private-network endpoints, or issue confidential client credentials:

1. The user runs a short-lived command such as `npx @mcp-use/inspector-bridge --session <code>` (or uses a browser extension/native helper).
2. The helper binds a random `127.0.0.1` callback and opens an outbound authenticated WebSocket to the hosted Inspector session; the hosted page never needs inbound access to the user's machine.
3. The helper owns PKCE state, OAuth callback handling, token exchange/refresh, and any client secret. Tokens remain in memory or the OS credential store rather than browser storage.
4. MCP traffic may continue through the hosted relay, or route through the helper for localhost/private-network targets.

This fallback was validated with `http://127.0.0.1:49152/callback`: Prompting Company returned `200` DCR and Vercel returned `201` DCR, both as public clients without a client secret. It avoids provider coordination for these two servers even though they reject the temporary public tunnel callback.

Vercel's hosted flow was validated without copying another product's identity: an operator-owned Vercel App with the exact Inspector callback worked as a public PKCE client. A production deployment should register its stable callback instead of an ephemeral tunnel hostname. The loopback companion remains a separate standards-compliant fallback. No architecture can guarantee zero-configuration access to a server that disables DCR and refuses every operator- or user-owned client; for that final tier the Inspector must accept a BYO client registration or report the upstream policy as the blocker.

## Manufact-hosted public inventory

The production Supabase inventory contains 35 verified, non-pending domains. Thirty are attached to a server and active deployment both currently marked `running`; those 30 were probed. The remaining verified domains were excluded from the live compatibility denominator because their server is `idle` or they lack a running active deployment.

### Compatible without OAuth

These nine endpoints accepted an unauthenticated MCP `initialize` and returned browser-compatible CORS:

| Public URL | MCP endpoint |
| --- | --- |
| `https://iching-mcp.playful-science.ai` | `/mcp` |
| `https://investor.rivetti.tech` | `/mcp` |
| `https://mcp.coingecko.com` | `/mcp` |
| `https://mcp.getconnectedfast.com` | `/mcp` |
| `https://mcp.iahorro.com` | `/mcp` |
| `https://mcp.wope.com` | `/mcp` |
| `https://meta-agent-v2.milonematteo.com` | `/mcp` |
| `https://research-mcp.yigitkonur.com` | `/mcp` |
| `https://userocky.zheat.xyz` | `/mcp` |

### Compatible OAuth discovery and preflight

These 14 endpoints returned a valid bearer challenge, browser-readable protected-resource and authorization-server metadata, and CORS-compatible token and registration preflights:

| Public URL | MCP endpoint |
| --- | --- |
| `https://agents-staging.openfunnel.dev` | `/mcp` |
| `https://agents.openfunnel.dev` | `/mcp` |
| `https://mcp-platform.rivetti.tech` | `/mcp` |
| `https://mcp.agentmail.to` | `/` |
| `https://mcp.agentphone.ai` | `/mcp` |
| `https://mcp.atlaswork.ai` | `/mcp` |
| `https://mcp.foxy.io` | `/mcp` |
| `https://mcp.foxydev.io` | `/mcp` |
| `https://mcp.item.app` | `/mcp` |
| `https://mcp.llm-stats.com` | `/mcp` |
| `https://mcp.manufact.com` | `/mcp` |
| `https://mcp.promptingco.com` | `/mcp` |
| `https://mcp.rehomeit.com` | `/mcp` |
| `https://mcp.sixtyfour.ai` | `/mcp` |

### Relay-solvable CORS exception

| Public URL | MCP endpoint | Finding |
| --- | --- | --- |
| `https://mcp.instacloud.com` | `/mcp` | MCP and protected-resource metadata allow browsers, but authorization-server metadata and token/registration responses omit ACAO. A full-flow relay should make this usable. |

### Upstream metadata failures

| Public URL | MCP endpoint | Finding |
| --- | --- | --- |
| `https://mcp.alphavantage.co` | `/` | MCP returns a bearer challenge, but advertised protected-resource metadata currently returns `522`. |
| `https://mcp.alphavantage.dev` | `/` | MCP returns a bearer challenge, but advertised protected-resource metadata currently returns `530`. |

A relay does not fix these failures because the upstream metadata itself is unavailable.

### Unavailable or blocked before MCP initialization

| Public URL | Result |
| --- | --- |
| `https://cal-com-luigi.mcp-use.run` | DNS/TLS-level fetch failure on `/`, `/mcp`, and `/sse` |
| `https://mcp-branch.flatpony.com` | Platform `522` on `/`, `/mcp`, and `/sse` |
| `https://mcp.meilleurtaux.com` | WAF-style `403` without CORS on `/`, `/mcp`, and `/sse` |
| `https://physics-lab-mcp.playful-science.ai` | Platform `522` on `/`, `/mcp`, and `/sse` |

## Inspector/proxy requirements derived from the audit

1. Give each Inspector connection one injected `fetch` implementation and use it for both the MCP transport and every SDK OAuth network call. A transport-only proxy is insufficient.
2. Keep the relay protocol-agnostic. It should forward method, body, status, redirects, `WWW-Authenticate`, `MCP-Session-Id`, `Location`, content type, and streaming response bodies without rewriting OAuth `resource` or issuer values.
3. Support `GET`, `POST`, `DELETE`, and `OPTIONS`, including SSE/Streamable HTTP and abort propagation.
4. Prefer one connection mode over opportunistically mixing direct and proxied calls. A direct-first probe can choose the mode, but once relay mode is selected the entire fetch chain should use it.
5. Leave authorization-page navigation in the browser. Relay metadata, registration, token, refresh, and revocation requests only.
6. Treat the relay as an SSRF boundary: allow only `http`/`https`, default to public HTTPS, resolve and reject private/link-local/loopback targets unless explicitly allowed for local development, re-check every redirect, cap redirect count and body size, and apply timeouts.
7. Redact query strings and authorization headers from relay logs. Store API credentials in secret/header configuration rather than target URL query parameters.
8. Resolve same-origin relay checks through the configured public deployment origin (`MCP_URL`) or trusted forwarded headers. Do not compare a public browser `Origin` only to the reverse proxy's internal request URL.

## Recommended regression matrix

Use these five third-party servers as permanent Inspector fixtures:

| Fixture | What it proves |
| --- | --- |
| Linear | OAuth metadata fetches use the relay, not only MCP transport |
| PostHog | Relay covers both MCP and a separate authorization-server origin |
| Supabase | Complete relay coverage for MCP, discovery, registration, and token exchange |
| Vercel | Root-path MCP handling, relay-preserved OAuth challenges, localhost DCR, hosted DCR rejection, and hosted manual-client success |
| Omnilex | Public PKCE/DCR control case plus MCP preflight header compatibility and real tool execution |

Add two Manufact fixtures:

- `https://mcp.manufact.com/mcp` for a protected, fully browser-compatible baseline.
- One unauthenticated `/mcp` endpoint for initialize and streaming behavior without OAuth.

Authenticated end-to-end validation should be a separate manual or credentialed test pass because it creates OAuth client registrations and requires user consent.
