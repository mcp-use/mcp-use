---
"mcp-use": minor
---

Add dynamic CSP domain injection for widgets: the request origin (from X-Forwarded-Host or Host header) is now automatically added to connectDomains and resourceDomains in tool metadata at tools/list time. This enables widgets to work correctly when accessed through proxies like ngrok, Cloudflare tunnels, or other reverse proxies.
