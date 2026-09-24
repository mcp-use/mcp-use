---
"@mcp-use/cli": minor
"create-mcp-use-app": patch
"mcp-use": minor
---

The CLI now discovers an optional `landing.tsx` in the MCP root. Browser requests use its server-rendered React content and hydrate it for interaction; development edits support Fast Refresh and CSS updates. Existing MCP, OAuth, and asset routes continue to work, including `--mcp-dir` and CDN asset URLs. `mcp-use/landing` exports `LandingPageProps` for custom components, and generated TypeScript projects include root `landing.tsx` in typechecking.
