---
"@mcp-use/cli": patch
---

Print a failed tool's error text with `mcp-use client <server> tools call`. Before, the text output said only "Tool <name> returned an error." and the reason was visible only with `--json`. JSON output is unchanged.
