---
"@mcp-use/cli": minor
---

feat(cli)!: drop the "active session" model — every `client` command now takes a name

The CLI client used to track an implicit "active session" that you switched
between with `client sessions switch`. Per-command flags like `--session` and
`--name` were sprinkled around to override it. The active state was hidden,
easy to get wrong, and forced every subcommand to handle "no session" as a
real case.

It's gone. The client name is now a required positional, and every
per-client command lives under `mcp-use client <name> <scope> <action>`:

```bash
# Before
mcp-use client connect https://mcp.manufact.com --name manufact
mcp-use client tools list
mcp-use client tools call read_file path=/x --session manufact
mcp-use client sessions list
mcp-use client sessions switch other-server
mcp-use client disconnect --all

# After
mcp-use client connect manufact https://mcp.manufact.com
mcp-use client manufact tools list
mcp-use client manufact tools call read_file path=/x
mcp-use client list
mcp-use client other-server <action>   # name addresses any saved client directly
mcp-use client manufact disconnect     # disconnect one at a time
```

**Breaking changes:**

- `client connect <url> --name <name>` → `client connect <name> <url>` (name is required, positional).
- `--session <name>` is removed from every per-client subcommand; the name comes from the path instead.
- `client sessions list` → `client list`.
- `client sessions switch` is removed — there is no active client to switch.
- `client disconnect --all` is removed; disconnect each client by name.
- `mcp-use screenshot` no longer falls back to the active session; pass `--session <name>` or `--mcp <url>` explicitly.

Existing `~/.mcp-use/cli-sessions.json` files keep working; the now-unused
`activeSession` field is silently ignored on load.

The CLI also gives clearer feedback for the common shape mistakes the new
syntax invites — passing only a URL to `connect`, forgetting the client
name before a per-client scope (`mcp-use client tools call foo`), or
typing an unknown subcommand — instead of the bare commander defaults.
