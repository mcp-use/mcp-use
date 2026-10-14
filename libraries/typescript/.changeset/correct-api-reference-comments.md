---
"@mcp-use/client": patch
"mcp-use": patch
---

Correct API reference comments. In `@mcp-use/client`, stdio `env` does not inherit the parent process environment, `defaultRequestOptions` applies only to the initial tool listing, `VMExecutorOptions.memoryLimitMb` is not enforced, and several examples referenced fields and connectors that do not exist. In `mcp-use`, legacy stateless GET, DELETE, and HEAD requests are documented as returning `204`, the `withMcpUse` defaults match the build, and the `mcp-use/vite`, `mcp-use/tanstack-start`, and `mcp-use/tanstack-start/vite` entry points now appear in the generated API reference.
