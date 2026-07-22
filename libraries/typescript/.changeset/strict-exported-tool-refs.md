---
"mcp-use": minor
"@mcp-use/cli": minor
"create-mcp-use-app": minor
---

Require `useCallTool("name")` names to resolve to exported server `ToolRef`
values once `mcp-env.d.ts` registers the server entry. Add
`useDynamicTool<Args, Result>("name")` as the explicit escape hatch for tools
registered from runtime data, loops, or OpenAPI documents.

Add `mcp-use typecheck`, which refreshes the managed `mcp-env.d.ts` entry
bridge and then invokes the project's local TypeScript compiler with
`--noEmit`. New projects scaffold the declaration and use this command in
their `typecheck` script.
