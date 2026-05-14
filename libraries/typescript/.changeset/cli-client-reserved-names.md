---
"@mcp-use/cli": patch
---

fix(cli): reject saved-server names that collide with per-server scope tokens

`mcp-use client <name> ...` routes any name that isn't a reserved subcommand
(`connect`, `list`, `remove`, `help`) to the per-server command tree. If a
user saved a server under one of the scope names — `tools`, `resources`,
`prompts`, `auth`, `disconnect`, `interactive` — every invocation against
that name would instead be caught by the "missing server name" routing and
the saved entry would be unreachable.

`client connect` now refuses those names up front with the list of reserved
names and a suggested rename, instead of silently saving an entry that can
never be addressed.
