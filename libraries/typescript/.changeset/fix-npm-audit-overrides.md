---
"@mcp-use/cli": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
"mcp-use": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides and refresh the lockfile so `pnpm audit` reports no known vulnerabilities.
