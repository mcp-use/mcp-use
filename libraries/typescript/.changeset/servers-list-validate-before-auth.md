---
"@mcp-use/cli": patch
---

Fix `servers list` reporting a bad `--limit` or `--skip` as `Not logged in.` when signed out. Pagination was validated after the cloud client was created, so an invalid page size surfaced as an operational failure with exit 1 instead of the usage error with exit 2 that `deployments list` already returns for the same input.
