---
"mcp-use": patch
---

fix: MCPAgent runtime fails with ERR_PACKAGE_PATH_NOT_EXPORTED in Node.js - package.json file didn't include an export path for ./agent, even though the agent code existed in src/agents/. Additionally, the build configuration (tsup.config.ts) wasn't building the agents as a separate entry point.
