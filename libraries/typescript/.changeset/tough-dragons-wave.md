---
"@mcp-use/inspector": patch
"mcp-use": patch
---

feat(inspector): add log copying functionality and enhance theme handling

- Implemented a new feature in IframeConsole to copy all logs to the clipboard, providing users with an easy way to access console logs
- Enhanced OpenAIComponentRenderer to manage widget readiness state and apply theme changes dynamically, improving user experience and visual consistency
- Updated ThemeProvider to synchronize theme application with Tailwind dark mode and OpenAI Apps SDK design tokens, ensuring a seamless theme transition
- Added a message signaling to the parent window when the widget is ready, enhancing communication between components
