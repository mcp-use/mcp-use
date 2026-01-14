---
"@mcp-use/cli": minor
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(cli): enhance login and deployment commands

- Updated the login command to handle errors gracefully
- Modified the deployment command to prompt users for login if not authenticated
- Removed the `fromSource` option from the deployment command
- Added checks for uncommitted changes in the git repository before deployment
- Updated various commands to consistently use `npx mcp-use login` for login instructions

refactor(inspector, multi-server-example): authentication UI and logic

- Simplified the authentication button logic in InspectorDashboard
- Updated the multi-server example to directly link to the authentication URL
