---
"@mcp-use/cli": patch
---

refactor(cli): user-facing copy now calls saved entries "servers" instead of "clients"

The CLI itself is the MCP client; the things it connects to are MCP
servers. The old copy referred to saved connections as "saved clients" /
"named clients", which is backwards and confused users.

User-facing strings (help text, error messages, table headers, REPL
prompts, docs) now consistently say "server" / "saved server". The
`mcp-use client` command name is unchanged — it's still the entry point
for client-side operations — so this is purely a wording change and no
scripts break.
