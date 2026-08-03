---
"mcp-use": minor
"create-mcp-use-app": minor
"@mcp-use/agent": patch
"@mcp-use/client": patch
"@mcp-use/inspector": patch
---

Prefer Bun over Yarn in the scaffold CLI and docs, and make production source maps opt-in.

**mcp-use**

- Add `--source-maps` so `mcp-use build` emits source maps only when requested (server and view bundles default to no maps).
- Widen `NextConfigLike` with an index signature so `withMcpUse` accepts arbitrary Next.js config fields.

**create-mcp-use-app**

- Replace `--yarn` with `--bun`, detect Bun from the user agent, and install/run with Bun when selected.

**@mcp-use/agent / @mcp-use/client**

- Point missing-optional-dependency errors at npm, pnpm, or Bun instead of Yarn.

**@mcp-use/inspector**

- Drop Yarn-specific install/lint scripts from the package scripts surface.
