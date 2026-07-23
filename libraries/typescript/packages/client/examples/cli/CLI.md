# CLI Client Examples

Shell examples for the `mcp-use client` CLI against HTTP demos or stdio servers.

## Quick Start

```bash
# Start demos (separate terminals)
cd ../_demo-servers && pnpm install --ignore-workspace
PORT=3101 pnpm v1
PORT=3102 pnpm v2

# Connect (name + url). Use --no-oauth for public demos.
mcp-use client connect demo http://127.0.0.1:3102/mcp --no-oauth

# Address the saved name on every later command
mcp-use client demo tools list
mcp-use client demo tools call echo '{"message":"hi"}'
mcp-use client list
mcp-use client remove demo
```

Stdio:

```bash
mcp-use client connect fs --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp" --no-oauth
mcp-use client fs tools list
```

## Shell scripts

| Script | What it does |
|--------|----------------|
| `cli_basic_example.sh` | Connect → tools list/call → remove (HTTP demo) |
| `cli_filesystem_example.sh` | Stdio filesystem server |
| `cli_multi_session_example.sh` | Two saved servers (v1 + v2 demos by default) |
| `cli_scripting_example.sh` | `--json` + `jq` automation against a demo |

```bash
chmod +x *.sh
MCP_SERVER_URL=http://127.0.0.1:3101/mcp ./cli_basic_example.sh
MCP_SERVER_URL=http://127.0.0.1:3102/mcp ./cli_basic_example.sh
./cli_filesystem_example.sh
./cli_multi_session_example.sh
MCP_SERVER_URL=http://127.0.0.1:3102/mcp ./cli_scripting_example.sh
```

Point `MCP_USE_CLI` at a local binary if needed:

```bash
MCP_USE_CLI="pnpm --dir ../../../cli exec mcp-use" ./cli_basic_example.sh
```

## Notes

- Commands are **name-scoped**: `mcp-use client <name> tools …` (there is no global active session / `sessions switch`).
- Public demos: pass `--no-oauth` so a 401 does not open a browser OAuth flow.
- `--json` is for scripting; human output is the default.
