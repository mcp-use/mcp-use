---
"@mcp-use/cli": patch
---

Deploy: HTTP 401 is treated as an invalid or expired API key for the current backend—short re-authenticate prompt instead of the GitHub App "not connected" flow. Runs `testAuth` after org resolution (including when org is read from disk). GitHub connection checks and install polling recover via the same re-auth path on 401.
