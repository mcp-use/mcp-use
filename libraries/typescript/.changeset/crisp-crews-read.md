---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

- fix(cli): add generate-types command for auto-generating TypeScript type definitions from tool schemas
- fix(mcp-use): add useCallTool hook for calling MCP tools with TanStack Query-like state management
- fix(mcp-use): add tool registry type generation utilities (generateToolRegistryTypes, zod-to-ts converter)
- fix(mcp-use): add type-safe helper functions for tool calls via generateHelpers
- fix(inspector): improve MCPAppsRenderer loading logic and enhance useWidget for iframe handling
- chore(create-mcp-use-app): update project template dependencies and TypeScript configuration
- docs: add comprehensive useCallTool documentation and update CLI reference with generate-types command
