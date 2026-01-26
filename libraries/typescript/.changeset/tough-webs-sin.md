---
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

feat: add MCP Apps support with dual-protocol widget rendering

- Add dual-protocol support enabling widgets to work with both MCP Apps and ChatGPT Apps SDK
- Add MCPAppsRenderer and MCPAppsDebugControls components for advanced debugging and visualization
- Add sandboxed iframe support with console logging and safe area insets for isolated widget rendering
- Add widget adapters (MCP Apps, Apps SDK) with protocol helpers for seamless cross-protocol compatibility
- Add browser host normalization for server connections in CLI
- Fix Zod JIT compilation to prevent CSP violations in sandboxed environments
- Add MCP Apps documentation and example server

feat: add HTML landing page for MCP server endpoints

- Add `generateLandingPage()` function that generates styled HTML landing pages for browser GET requests
- Include connection instructions for Claude Code, Cursor, VS Code, VS Code Insiders, and ChatGPT