---
"@mcp-use/inspector": patch
---

Fix two Inspector crashes and resets: searchable pickers (debugger timezone and locale) no longer unmount the app when the checked option is filtered out while typing, and Connection Settings keeps edits while a failed connection retries instead of resetting the form on every retry.
