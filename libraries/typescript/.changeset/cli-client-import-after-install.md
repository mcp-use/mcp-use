---
"@mcp-use/cli": patch
---

Load `@mcp-use/client` right after `mcp-use client` or `mcp-use screenshot` auto-installs it. On Node 24 the first run installed the package but still reported `@mcp-use/client is not installed`, because Node cached the failed lookup from the import that triggered the install. The CLI now finds the installed copy with `module.findPackageJSON` and imports its entry file. The CLI also no longer replaces `globalThis.localStorage` before loading the client; the client stops reading it in Node instead.
