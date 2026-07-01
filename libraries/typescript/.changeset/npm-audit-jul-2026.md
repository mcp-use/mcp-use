---
"mcp-use": patch
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides and refresh the lockfile so `pnpm audit` reports no known vulnerabilities.
