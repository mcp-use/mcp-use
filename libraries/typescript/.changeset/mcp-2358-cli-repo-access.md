---
"@mcp-use/cli": patch
---

Fix repo access check during deploy to look across all GitHub App installations instead of only the first one, so deploys of repos owned by any linked installation no longer fail the access check.
