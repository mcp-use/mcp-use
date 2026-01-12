---
"@mcp-use/cli": minor
---

feat(cli): enhance hot module reloading and server management

- Improved hot module reloading (HMR) support by allowing local `tsx` usage, falling back to `npx` if not found
- Updated server command execution to handle TypeScript imports more effectively
- Enhanced file watching capabilities to include `.ts` and `.tsx` files while ignoring unnecessary patterns
- Streamlined tool, prompt, and resource registration during HMR to directly inject into active sessions without removal, preserving existing configurations
- Added detailed logging for file changes and watcher readiness to improve developer experience
