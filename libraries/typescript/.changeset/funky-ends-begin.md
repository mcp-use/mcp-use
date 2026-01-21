---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix(inspector): standardize proxy configuration and enhance connection handling

- Renamed `customHeaders` to `headers` in `InspectorDashboard` and `ServerConnectionModal` for consistency.
- Removed unused state management for connecting servers in `InspectorDashboard`.
- Improved server connection handling by introducing a `handleReconnect` function to manage reconnection attempts.
- Updated UI elements to reflect connection states more accurately, including hover effects and error displays.
- Enhanced error handling for unauthorized connections, providing clearer user feedback.

These changes aim to streamline the connection management process and improve the overall user experience in the inspector interface.