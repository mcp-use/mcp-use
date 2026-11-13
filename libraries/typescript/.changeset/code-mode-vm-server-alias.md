---
"@mcp-use/client": patch
---

The VM code-mode executor now exposes server names that contain characters which are not valid in a JavaScript identifier (`my-server`, `my.server`) through the sanitized alias (`my_server`), matching the E2B executor, so the same code-mode snippet runs on both. Names that still cannot be written as a bare identifier after sanitizing (for example `123-server` → `123_server`) remain reachable only as `globalThis["123_server"]`.
