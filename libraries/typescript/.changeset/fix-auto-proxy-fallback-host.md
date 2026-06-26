---
"mcp-use": patch
---

Fix `useMcp` auto proxy fallback pointing at a retired host. The default `autoProxyFallback` proxy address was `https://inspector.mcp-use.com/inspector/api/proxy`, which now 301-redirects to `inspector.manufact.com`. Browsers treat a redirect on a CORS preflight as a hard failure, so the automatic direct→proxy fallback could never connect (it would retry through a dead URL and fail). The default now points at the live `https://inspector.manufact.com/inspector/api/proxy`.
