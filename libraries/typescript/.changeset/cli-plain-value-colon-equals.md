---
"@mcp-use/cli": patch
---

fix(cli): keep `:=` inside a plain `key=value` tool or prompt argument instead of splitting the key there, so `code="x := 1"` is sent as a string
