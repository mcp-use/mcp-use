---
"@mcp-use/cli": patch
---

Fix two delete commands reporting success for targets that do not exist. `servers env unset` printed `Deleted <key>.` and exited 0 when no variable matched the key and branch, and `client remove` printed `Removed <name>.` for a name that was never saved. Both now fail instead of hiding a typo or a mismatched `--branch` behind a successful-looking result.
