---
"mcp-use": patch
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides (hono, dompurify, protobufjs, js-yaml, form-data, brace-expansion, shell-quote, joi, @opentelemetry/core, @babel/core) and refresh the lockfile so `pnpm audit` reports no known vulnerabilities.
