---
"@mcp-use/inspector": patch
---

Block loopback proxy targets by default. `mountInspector` now defaults `oauthProxyAllowLoopback` to `false` (previously `true`), so a publicly reachable embedded/hosted Inspector no longer proxies requests to the host's loopback services (SSRF). The standalone CLI keeps allowing loopback for local development, but defaults to blocking it when `NODE_ENV=production` (which the published Docker image sets); set `INSPECTOR_ALLOW_LOOPBACK=true` to override either way.
