---
"@mcp-use/inspector": patch
---

chore(inspector): add refresh buttons for tools, resources, and prompts lists

**UI Enhancements:**

- Added refresh buttons with loading states to Tools, Resources, and Prompts tabs
- Implemented `ListTabHeader` component with refresh functionality and spinning icon animation
- Added refresh handlers in `ToolsTab`, `ResourcesTab`, and `PromptsTab` with loading state management
- Connected refresh callbacks through `LayoutContent` to enable manual list updates

**Developer Experience:**

- Allows users to manually refresh primitives without reconnecting to the server
- Improves workflow when testing server changes or investigating stale data

Commits: 03238f28
