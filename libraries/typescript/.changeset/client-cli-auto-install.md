---
"mcp-use": minor
---

Auto-install `@mcp-use/client` when `mcp-use client` or `mcp-use screenshot` needs it and the package is missing. Installs into the nearest project when a `package.json` exists; otherwise uses a global sandbox at `~/.mcp-use/client-sdk/`. Fixes `npx mcp-use client connect …` without a separate client install step.
