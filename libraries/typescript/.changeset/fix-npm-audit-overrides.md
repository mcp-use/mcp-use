---
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
"create-mcp-use-app": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides (hono, js-yaml, dompurify, brace-expansion, form-data, protobufjs, shell-quote, joi, @opentelemetry/core, @babel/core) and refresh the lockfile so `pnpm audit` reports no known vulnerabilities.
