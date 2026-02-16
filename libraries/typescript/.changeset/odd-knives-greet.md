---
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

fix(inspector): enhance MCPAppsRenderer and OpenAIComponentRenderer with loading states and spinner

- Updated MCPAppsRenderer to include a loading spinner during widget initialization, improving user feedback.
- Introduced a new `isReady` state to manage the loading state effectively.
- Enhanced OpenAIComponentRenderer to adjust display properties based on the new configuration for better responsiveness.
- Added a maximum width for the Picture-in-Picture mode in MCP_APPS_CONFIG for improved layout control.
- Refactored iframe loading handling to ensure proper state management and user experience during loading phases.
