---
"@mcp-use/cli": patch
---

fix(cli): error when `client screenshot` omits required tool arguments

`mcp-use client screenshot --tool <tool>` (and `mcp-use client <name>
screenshot --tool <tool>`) silently produced a blank PNG and exited 0
when the target tool declared required arguments but none were passed.
The command now mirrors `client tools call`: it prints "This tool
requires arguments." along with the tool schema and exits 1, before
launching the inspector or browser.
