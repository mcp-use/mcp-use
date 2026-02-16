---
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(inspector): improve loading state and UI feedback in OpenAIComponentRenderer

- Replaced shimmer animation with a Spinner component for a more consistent loading experience
- Introduced a skeleton loading state that only displays on the initial load of the widget
- Updated ToolResultDisplay to adjust the order of view checks for better clarity
- Enhanced ToolsList to conditionally display parameter counts based on tool input schemas
