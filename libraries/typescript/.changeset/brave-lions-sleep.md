---
"@mcp-use/inspector": patch
---

feat(inspector): enhance error handling and logging for widget components

- Implemented error logging functionality in MCPAppsRenderer and OpenAIComponentRenderer to capture and post error messages and stack traces to the parent window
- Added global error and unhandled promise rejection listeners in shared-utils to emit runtime errors with detailed context
- Enhanced console error handling in mcp-apps route to serialize and send console errors to the parent window, improving debugging capabilities
- Refactored MCPAppsRenderer to replace `isReady` state with `initCount` for better tracking of initialization events
