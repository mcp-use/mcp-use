---
"mcp-use": patch
---

feat(mcp): implement direct stdio connector handling in Node.js client

- Added support for handling the stdio connector directly within the Node.js MCPClient, allowing for command and argument configuration
- Updated the loadConfigFile function to dynamically import the fs module, preventing unnecessary inclusion in browser bundles
- Enhanced error handling to ensure that the stdio connector is only utilized in the appropriate environment, improving compatibility and clarity
