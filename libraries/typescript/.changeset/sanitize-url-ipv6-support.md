---
"@mcp-use/client": patch
---

fix(client): allow bracketed IPv6 hostnames and prevent path double percent-encoding in sanitizeUrl

- Support RFC 3986 and WHATWG bracketed IPv6 hostnames (e.g., `[::1]`) in `sanitizeUrl` instead of falsely rejecting them as malformed.
- Preserve already percent-encoded path octets (`%XX`) in `url.pathname` and `url.hash` to prevent double percent-encoding (such as `%20` -> `%2520`).
- Preserve forward slashes in fragment identifiers for SPA routes (e.g. `#/routes/profile`).
