---
"mcp-use": patch
"@mcp-use/cli": patch
"@mcp-use/inspector": patch
"create-mcp-use-app": patch
---

Harden transitive dependencies: tighten root `pnpm` overrides (shell-quote, form-data, vite, hono, brace-expansion, joi, protobufjs, js-yaml, @opentelemetry/core, dompurify, @babel/core) and refresh the lockfile so `pnpm audit` reports no known vulnerabilities.
