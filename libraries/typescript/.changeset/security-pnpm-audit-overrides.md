---
"mcp-use": patch
"@mcp-use/cli": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides (vite, axios, lodash, hono, brace-expansion, path-to-regexp, yaml) and refresh the lockfile so `pnpm audit` reports no known vulnerabilities; add a `lodash` override to the `mcp-apps` scaffold template for standalone installs.
