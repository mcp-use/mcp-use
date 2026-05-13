---
"@mcp-use/cli": patch
---

feat(cli): add `mcp-use client remove <name>` to drop a saved server

Saved servers could be added (`client connect`) and listed (`client list`),
but the only way to delete one was to hand-edit
`~/.mcp-use/cli-sessions.json`. `client remove <name>` now does this: it
errors if no server by that name exists, closes any in-process connection,
deletes the entry, and — for OAuth-authenticated servers — also revokes
the stored tokens for that URL. If another saved server still points at
the same URL the tokens are kept (they're URL-keyed, so wiping them would
break the sibling); the CLI prints which sibling is keeping them alive.
