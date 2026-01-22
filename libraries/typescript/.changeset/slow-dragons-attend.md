---
"@mcp-use/cli": patch
---

fix: pass environment variables and deployment config during redeployment

When redeploying an existing deployment, the CLI now properly passes environment variables, build command, start command, and port configuration to the redeployment API endpoint. Previously, redeployments would not include these updated settings.
