---
"@mcp-use/inspector": patch
---

feat(inspector): add environment variable for iframe embedding configuration

- Introduced `MCP_INSPECTOR_FRAME_ANCESTORS` environment variable to control which origins can embed the inspector widget in iframes, enhancing security and flexibility for both development and production environments.
- Updated documentation to include usage examples and best practices for setting the variable, ensuring clarity for users embedding the inspector in their applications.
- Refactored server routes and utilities to utilize the new environment variable for setting Content Security Policy (CSP) headers, improving security measures against unauthorized embedding.