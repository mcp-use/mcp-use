---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
"@mcp-use/cli": patch
---

feat(hmr): enhance synchronization for tools, prompts, and resources

- Implemented a generic synchronization mechanism for hot module replacement (HMR) that updates tools, prompts, and resources in active sessions without removal.
- Added support for detecting changes in definitions, including renames and updates, ensuring seamless integration during HMR.
- Improved logging for changes in registrations, enhancing developer visibility into updates during the HMR process.
- Introduced a new file for HMR synchronization logic, centralizing the handling of updates across different primitive types.
