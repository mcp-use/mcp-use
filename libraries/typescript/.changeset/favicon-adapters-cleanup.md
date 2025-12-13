---
"mcp-use": minor
"@mcp-use/cli": minor
"create-mcp-use-app": patch
---

**Breaking Changes:**
- LangChain adapter no longer exported from main entry point. Import from `mcp-use/adapters` instead:
  ```ts
  // Before
  import { LangChainAdapter } from 'mcp-use'
  
  // After
  import { LangChainAdapter } from 'mcp-use/adapters'
  ```
- Moved `@langchain/core` and `langchain` from dependencies to optional peer dependencies

**Features:**
- Added favicon support for widget pages. Configure via `favicon` option in `ServerConfig`:
  ```ts
  const server = createMCPServer({
    name: 'my-server',
    version: '1.0.0',
    favicon: 'favicon.ico' // Path relative to public/ directory
  });
  ```
- Favicon automatically served at `/favicon.ico` for entire server domain
- CLI build process now includes favicon in widget HTML pages

**Improvements:**
- Automatic cleanup of stale widget directories in `.mcp-use` folder
- Dev mode now watches for widget file/directory deletions and cleans up build artifacts
- Added long-term caching (1 year) for favicon assets

