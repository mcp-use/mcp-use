---
"@mcp-use/cli": minor
"create-mcp-use-app": patch
"mcp-use": minor
---

The CLI now discovers an optional `landing.tsx` in the MCP root. Browser requests use its server-rendered React content and hydrate it for interaction; development edits support Fast Refresh and CSS updates. Existing MCP, OAuth, and asset routes continue to work, including `--mcp-dir` and CDN asset URLs. Custom components read server data with hooks from `mcp-use/landing` (`useServerInfo`, `useToolList`, `usePromptList`, `useResourceList`). Like views, `landing.tsx` can use Tailwind classes with no CSS file. New projects from every `create-mcp-use-app` template start with a Tailwind-styled `landing.tsx` similar to the built-in page, and their `tsconfig.json` typechecks it in the project root or any nested MCP root.
