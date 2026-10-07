---
"@mcp-use/cli": patch
---

Fix deployment dashboard links to use the selected organization slug and server ID for managed uploads and GitHub deployments. Leave the link unavailable when an organization has no slug instead of returning an invalid route.
