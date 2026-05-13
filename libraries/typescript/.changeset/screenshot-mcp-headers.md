---
"@mcp-use/cli": minor
---

feat(cli): add `--header` / `-H` to `mcp-use screenshot` for authenticated `--mcp <url>` servers

`mcp-use screenshot --mcp <url>` now accepts repeatable `-H, --header "Key: Value"` flags (curl-style), letting you screenshot authenticated MCP servers without first running `mcp-use client connect`. The most common use is a static bearer token:

```
mcp-use screenshot --tool show-board \
  --mcp https://my-mcp.example.com/mcp \
  -H "Authorization: Bearer $TOKEN"
```

Headers are only honored with `--mcp <url>`; passing `--header` alongside `--session` (or the active saved session) errors with a clear message, since saved sessions already carry their own OAuth/bearer auth from `mcp-use client connect`. Header values are split on the first `:` only, so colons inside the value (e.g. ISO timestamps) are preserved. Whitespace around key and value is trimmed.
