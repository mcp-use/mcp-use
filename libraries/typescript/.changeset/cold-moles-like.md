---
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(inspector): add reconnect functionality for failed connections

- Introduced a reconnect button in the InspectorDashboard for connections that fail, allowing users to attempt reconnection directly from the UI.
- Enhanced the dropdown menu to include a reconnect option for failed connections, improving user experience and accessibility.
- Updated HttpConnector to disable automatic reconnection, shifting the responsibility to higher-level logic for better control over connection management.
