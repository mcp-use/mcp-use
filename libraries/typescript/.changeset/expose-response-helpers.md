---
"mcp-use": patch
"create-mcp-use-app": patch
---

Make `mcp-use/server` response helpers discoverable to humans and coding agents.

- **`MCPServer.tool()` JSDoc**: each `@example` block now includes the matching `import { ... } from "mcp-use/server"` line, plus a note that helpers (`text`, `object`, `image`, `markdown`, `html`, `error`, `widget`, …) are exported from `mcp-use/server`. Previously the examples called `text(...)` / `error(...)` with no import, so anyone reading the hover doc had no breadcrumb to the package.
- **`create-mcp-use-app` blank template**: replaces the commented-out `fetch-weather` placeholder with a real, working `echo` tool that imports `text` from `mcp-use/server` and `z` from `zod`. Scaffolded projects now start with a runnable tool and a concrete example of the response-helper pattern, rather than only commented snippets.
