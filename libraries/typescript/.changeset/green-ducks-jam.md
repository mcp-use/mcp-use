---
"mcp-use": patch
---

fix(logging): enhance logging consistency and add tests for logLevel behavior

- Improved logging consistency across React components by ensuring all console calls are routed through the Logger class.
- Added comprehensive tests for Logger configuration, including log level filtering and silent mode behavior.
- Updated useMcp hook tests to validate logLevel options and their interactions.

