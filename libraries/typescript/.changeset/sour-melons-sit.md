---
"@mcp-use/inspector": minor
"mcp-use": minor
---

feat(inspector): enhance client configuration and UI components

- Added support for client exports in the build process by introducing a new build script for client exports in `package.json`.
- Enhanced the `CommandPalette` and `SdkIntegrationModal` components to utilize local utility functions instead of external dependencies.
- Introduced a new CSS animation for status indicators in `index.css`.
- Updated the `LayoutHeader` component to conditionally display notification dots based on tab activity.
- Removed the deprecated `AddToClientDropdown` component and adjusted related imports accordingly.
- Improved client configuration examples in the `notification-client` and `sampling-client` files to include client identification for better server-side logging.
- Cleaned up unused imports and ensured consistent formatting across several files.
