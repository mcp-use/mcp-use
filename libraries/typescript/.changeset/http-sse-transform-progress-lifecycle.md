---
"@mcp-use/client": patch
---

Fix HTTP connection and socket leak on aborted requests in `HttpConnector.observeSseProgress` by replacing stream teeing with an in-line pass-through `TransformStream`.
