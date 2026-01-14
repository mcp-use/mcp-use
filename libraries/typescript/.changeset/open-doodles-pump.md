---
"@mcp-use/cli": minor
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(cli): enhance login and deployment commands with improved error handling and user prompts

- Updated the login command to handle errors gracefully, providing user feedback on login failures.
- Modified the deployment command to prompt users for login if not authenticated, enhancing user experience.
- Removed the `fromSource` option from the deployment command, streamlining the deployment process.
- Added checks for uncommitted changes in the git repository before deployment, ensuring users are aware of their current state.
- Updated various commands to consistently use `npx mcp-use login` for login instructions, improving clarity.

refactor(inspector, multi-server-example): streamline authentication UI and logic

- Simplified the authentication button logic in InspectorDashboard, consolidating the rendering of the authentication state and removing redundant elements.
- Updated the multi-server example to directly link to the authentication URL, enhancing user experience by eliminating unnecessary prompts and improving clarity in the authentication process.
