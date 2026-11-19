---
"@mcp-use/cli": patch
---

`mcp-use deploy --no-github` no longer reports `deployment_failed` when Cloud stops the CLI's redeploy because the webhook deployment of the same commit replaced it. The wait follows that newer deployment and reports its ID and status.
