---
"@mcp-use/cli": minor
---

feat(cli): move `screenshot` under `client` and require an explicit session name

The standalone `mcp-use screenshot` command has been folded into `mcp-use client`, with two forms:

- **Saved-server form:** `mcp-use client <name> screenshot --tool <tool>` reuses the auth from `mcp-use client connect`. The `--session` flag is gone — the server name is now the explicit positional that every other `mcp-use client <name> ...` command already takes.
- **Ad-hoc form:** `mcp-use client screenshot --mcp <url> --tool <tool>` keeps `-H/--header` for authenticating one-off captures. Useful for programmatic / CI use that doesn't want to first save a server with `mcp-use client connect`.

**Breaking changes:**

- `mcp-use screenshot ...` no longer exists. Use `mcp-use client <name> screenshot ...` (saved server) or `mcp-use client screenshot --mcp <url> ...` (ad-hoc).
- The `--session <name>` flag is removed. The saved-server name is the positional in `mcp-use client <name> screenshot`.
- `screenshot` is now a reserved name and can't be used as a saved-server name.

This mirrors the rest of the `mcp-use client` surface after the removal of the implicit "active session" model — every per-server command takes the server name as its first positional argument.
