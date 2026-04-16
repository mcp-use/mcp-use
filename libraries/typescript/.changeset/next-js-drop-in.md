---
"@mcp-use/cli": minor
"mcp-use": minor
---

feat(cli, mcp-use): Next.js drop-in support for MCP servers

- `mcp-use dev/build/start --mcp-dir <dir>` lets a Next.js app colocate an MCP server (default `src/mcp/`) alongside its routes, sharing the same `@/*` aliases, Tailwind styles, and component library.
- Auto-shims Next.js server-runtime modules (`server-only`, `client-only`, `next/cache`, `next/headers`, `next/navigation`, `next/server`) when `next` is detected in `package.json`, so tools transitively imported from the app don't blow up outside a Next runtime. Shim list is centralized in `next-shims-registry.json`.
- Loads Next.js env cascade (`.env`, `.env.development`, `.env.local`, `.env.development.local`) in the MCP server process.
- Widget builds fail fast with an actionable error when a widget (or a module it transitively imports) pulls in a Next.js server-only module — widgets run in a browser iframe, so the right fix is to read server data in an MCP tool and pass it through widget props.
