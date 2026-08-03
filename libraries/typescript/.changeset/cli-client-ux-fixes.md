---
"mcp-use": patch
---

Fix `mcp-use client` UX after auto-installing `@mcp-use/client`: the connect command now continues in the same run by importing the client SDK from the project install location instead of the npx cache. OAuth connect prompts before opening a browser in a TTY (`--open` / `--no-open` override). `mcp-use client --help` prints client-specific usage instead of the top-level command list.
