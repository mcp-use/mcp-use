---
"@mcp-use/cli": patch
---

`mcp-use client` and `mcp-use screenshot` use the `@mcp-use/client` already installed in your project, including when the CLI runs through `npx`. When no copy is found, they install it into `~/.mcp-use/client-sdk` and no longer add it to your project. Before, running the CLI with `npx` in a pnpm project ran `npm install` there, which crashed with `Cannot read properties of null (reading 'matches')` or wrote a `package-lock.json` next to `pnpm-lock.yaml` (#3081).

With `--json`, a missing `@mcp-use/client` still fails with `client_install_required`, now without an `npm install` next step: the message says to install it in the project with its package manager.
