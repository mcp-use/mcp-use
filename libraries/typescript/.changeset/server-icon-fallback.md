---
"@mcp-use/client": patch
---

`useMcp` no longer stores an HTTP error page as the server icon. When the icon a server advertises returns an error status (for example, a 404 because `public/icon.svg` is missing), the request fails, or the host doesn't answer within 5 seconds, `useMcp` now falls back to favicon detection, as it already does for servers with no icon. `ensureIconLoaded()` no longer waits forever on an icon host that never responds.
