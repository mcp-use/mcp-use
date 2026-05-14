---
"@mcp-use/cli": patch
---

fix(cli): show a "not found, here's how to connect" message instead of the per-server help when `mcp-use client <name>` targets an unknown server

Running `mcp-use client <name>` with no subcommand used to fall through to
commander's per-server help — listing `tools`, `resources`, `prompts`, etc.
That help is only useful once the server actually exists; for a name the
user hasn't connected yet it just leaks the subcommand surface without
telling them how to make the name resolve.

When the name doesn't match a saved server, the CLI now prints the
`client connect <name> <url>` hint (plus a pointer to `client list`) and
exits non-zero. The per-server help is still shown when the server exists.
