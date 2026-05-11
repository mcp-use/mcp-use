---
"mcp-use": patch
"create-mcp-use-app": patch
---

Make `mcp-use/server` response helpers discoverable to humans and coding agents.

- **`MCPServer.tool()` JSDoc**: each `@example` block now includes the matching `import { ... } from "mcp-use/server"` line, plus a note that helpers (`text`, `object`, `image`, `markdown`, `html`, `error`, `widget`, …) are exported from `mcp-use/server`. Previously the examples called `text(...)` / `error(...)` with no import, so anyone reading the hover doc had no breadcrumb to the package.
- **`create-mcp-use-app` blank template**: the commented tool/resource/prompt blocks previously called `text(...)`, `object(...)`, and `z.object(...)` without showing where any of those came from — and the file's top-level imports never referenced them either. Each commented block now includes the relevant `import { ... } from "mcp-use/server"` / `import { z } from "zod"` lines inside the comment, alongside a leading note naming the available response helpers. The template stays truly blank (no tools registered) but the discovery path is now local to the file.
