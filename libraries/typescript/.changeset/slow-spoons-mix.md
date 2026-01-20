---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## Dependency Updates

Updated 36 dependencies across all TypeScript packages to their latest compatible versions.

### Major Updates

- **react-resizable-panels**: 3.0.6 → 4.4.1
  - Migrated to v4 API (`PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`)
  - Updated `direction` prop to `orientation` across all inspector tabs
  - Maintained backward compatibility through wrapper component

### Minor & Patch Updates

**Framework & Build Tools:**
- @types/node: 25.0.2 → 25.0.9
- @types/react: 19.2.7 → 19.2.8
- @typescript-eslint/eslint-plugin: 8.49.0 → 8.53.1
- @typescript-eslint/parser: 8.49.0 → 8.53.1
- prettier: 3.7.4 → 3.8.0
- typescript-eslint: 8.49.0 → 8.53.1
- vite: 7.3.0 → 7.3.1
- vitest: 4.0.15 → 4.0.17

**Runtime Dependencies:**
- @hono/node-server: 1.19.7 → 1.19.9
- @langchain/anthropic: 1.3.0 → 1.3.10
- @langchain/core: 1.1.12 → 1.1.15
- @langchain/google-genai: 2.1.0 → 2.1.10
- @langchain/openai: 1.2.0 → 1.2.2
- @mcp-ui/client: 5.17.1 → 5.17.3
- @mcp-ui/server: 5.16.2 → 5.16.3
- posthog-js: 1.306.1 → 1.330.0
- posthog-node: 5.17.2 → 5.22.0
- ws: 8.18.3 → 8.19.0

**UI Components:**
- @eslint-react/eslint-plugin: 2.3.13 → 2.7.2
- eslint-plugin-format: 1.1.0 → 1.3.1
- eslint-plugin-react-refresh: 0.4.25 → 0.4.26
- framer-motion: 12.23.26 → 12.27.1
- motion: 12.23.26 → 12.27.1
- markdown-to-jsx: 9.3.5 → 9.5.7
- lucide-react: 0.561.0 → 0.562.0
- vite-express: 0.21.1 → 0.22.0

**Utilities:**
- globby: 16.0.0 → 16.1.0
- fs-extra: 11.3.2 → 11.3.3
- ink: 6.5.1 → 6.6.0

### Removed

- Removed `@ai-sdk/react` from inspector (unused, only in tests)
- Removed `ai` from mcp-use dev dependencies (unused, only in tests/examples)
