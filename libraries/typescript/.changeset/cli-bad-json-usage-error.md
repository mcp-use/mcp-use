---
"@mcp-use/cli": patch
---

Report a malformed JSON argument to `client` and `screenshot` as a usage error instead of letting the engine's `SyntaxError` escape. A bad `{...}` or `key:=<json>` value exited 1 with a bare parser message and no indication of which argument was wrong, while every other grammar mistake in the same parser exits 2.
