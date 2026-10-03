---
"@mcp-use/client": patch
---

`useMcp` no longer stores an HTTP error page as the server icon. When the icon a server advertises returns an error status, such as a 404 because `public/icon.svg` is missing, or the request itself fails, `useMcp` now falls back to favicon detection, as it already did for servers with no icon.
