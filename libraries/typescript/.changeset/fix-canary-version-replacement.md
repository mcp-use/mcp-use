---
"create-mcp-use-app": patch
---

Fixed canary flag not properly replacing package versions when using published templates. The `--canary` flag now correctly replaces both `workspace:*` patterns (in local development) and caret versions (in published packages) with `"canary"` versions of `mcp-use`, `@mcp-use/cli`, and `@mcp-use/inspector`.

