---
"@mcp-use/inspector": patch
---

fix(inspector): update MCPAppsRenderer and OpenAIComponentRenderer for improved border handling and status display

- Changed default state for `prefersBorder` in MCPAppsRenderer to false, aligning with updated UI specifications.
- Updated OpenAIComponentRenderer to conditionally display status labels above the widget in inline mode, enhancing user feedback.
- Adjusted CSS classes for better layout management based on display modes, improving overall user experience.
- Increased z-index for sticky elements in ToolResultDisplay to ensure proper layering in the UI.