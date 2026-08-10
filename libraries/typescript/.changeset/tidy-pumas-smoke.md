---
"create-mcp-use-app": patch
---

Sanitize the npm package name for named projects, not just `.`. A name like `My "App"` was written verbatim into the template's `index.ts`, producing invalid TypeScript.
