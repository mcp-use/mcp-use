---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

- **@mcp-use/cli**: Add update check that notifies when a newer mcp-use release is available. Fix TSC build to use node with increased heap and avoid npx installing wrong package.

- **create-mcp-use-app**: Add @types/react and @types/react-dom to template devDependencies. Slim down generated READMEs. Improve mcp-apps template (Carousel, product-search-result widget). Include .mcp-use in tsconfig. Fix postinstall script.

- **@mcp-use/inspector**: Improve Iframe Console with expandable logs, level filter, search, resizable height. Add widget debug context for chat. Refactor MCP Apps debug controls (tool props JSON view, required props hint, SEP-1865 semantics). Add CDN build. Fix useSyncExternalStore first-render handling.

- **mcp-use**: Refactor useWidget to merge props from toolInput and structuredContent per SEP-1865. Add updateModelContext and useMcp clientOptions. Add typescript to examples.
