---
"@mcp-use/client": minor
---

Support generic pre-registered confidential OAuth clients in `useMcp` with `oauth.clientSecret`. Browser flows require an OAuth proxy and complete the authorization-code exchange in the popup opener so client secrets remain in memory and are never persisted in callback state or localStorage.
