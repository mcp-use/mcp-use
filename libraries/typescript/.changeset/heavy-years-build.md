---
"@mcp-use/inspector": patch
"mcp-use": patch
---

fix: ensure pending state is emulated for widgets, reflecting ChatGPT behaviour

**Inspector Changes:**

- Updated MCPAppsRenderer and OpenAIComponentRenderer to handle tool output and metadata more effectively, allowing for immediate rendering of widgets even when results are pending
- Enhanced MessageList and ToolResultRenderer to support immediate rendering of widget tools, improving responsiveness during tool execution
- Added utility functions for widget detection and pre-rendering capabilities based on tool metadata

**Server Changes:**

- Introduced delayed weather tool example (`get-weather-delayed`) in conformance server to demonstrate widget lifecycle management with artificial delays

**Documentation:**

- Updated inspector and widget lifecycle testing documentation
- Enhanced debugging guides for ChatGPT Apps with widget lifecycle testing instructions

These changes address Issue #930, ensuring widgets can display loading states and update seamlessly upon tool completion.

Commits: fea26ff4
