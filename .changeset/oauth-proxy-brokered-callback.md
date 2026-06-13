---
"mcp-use": patch
---

OAuth proxy mode now brokers the upstream callback through the server's own `/oauth/callback` instead of forwarding each MCP client's redirect URI upstream. Register a single redirect URI on your OAuth provider — `<your-server-domain>/oauth/callback` — and every MCP client (Claude, ChatGPT, the inspector, ...) can authenticate without registering its own callback. The client's redirect URI and state are carried statelessly through the upstream `state` parameter, PKCE stays end-to-end between the client and the upstream, and `/token` rewrites `redirect_uri` to match the brokered authorize request.

If you previously registered client callback URLs (e.g. `http://localhost:3000/inspector/oauth/callback`) on your provider, add `<your-server-domain>/oauth/callback` instead.
