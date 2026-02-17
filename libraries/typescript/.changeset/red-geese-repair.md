---
"@mcp-use/inspector": minor
"mcp-use": patch
---

feat(inspector): enhance ToolsTab with bulk paste functionality and auto-fill dialog

- Implemented a new bulk paste feature in the ToolsTab component, allowing users to paste JSON or JavaScript object syntax directly into input fields.
- Added an auto-fill dialog to confirm updates when pasted data would overwrite existing values, improving user experience and data integrity.
- Introduced utility functions for parsing pasted text and converting JavaScript object syntax to valid JSON.
- Updated ToolInputForm and ToolExecutionPanel components to support the new bulk paste functionality and visual feedback for auto-filled fields.
