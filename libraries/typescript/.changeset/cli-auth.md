---
"@mcp-use/cli": patch
---

`login`, `logout` and `whoami` are rewritten for agents and the current Manufact Cloud API.

- Without a TTY, or with `--json`, `login` prints the device code as JSON and exits. `login --device-code <code>` finishes the login once the code is approved.
- A device login creates an API key named `CLI · <hostname>` and stores it in `~/.manufact/auth.json` (mode 0600). A credential in `~/.mcp-use/config.json` moves there automatically.
- `MANUFACT_TOKEN` overrides the stored key. `MCP_USE_API_KEY` is still read.
- `logout` revokes the key `login` created and always deletes the local credential. A failed revoke is a warning, not an error.
- `whoami` shows the email, the active organization, the key's name and where the key comes from.
- Identity and organization lookups use documented Cloud endpoints.
