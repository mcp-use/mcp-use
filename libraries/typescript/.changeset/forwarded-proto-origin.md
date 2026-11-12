---
"mcp-use": patch
---

Honor `X-Forwarded-Proto` and `Forwarded: proto=` when the proxy sends no forwarded host. The public origin now uses the forwarded protocol with the request's `Host`, so servers behind TLS-terminating proxies such as Heroku, AWS ALB, Cloud Run or Fly report `https://` icon, asset and landing page URLs instead of `http://` when `MCP_URL` is unset.
