---
"create-mcp-use-app": patch
"@mcp-use/cli": patch
---

Print paths that work on Windows. create-mcp-use-app quotes the `cd` hint when the project name contains spaces, so `cd "my app"` can be pasted into PowerShell, bash or cmd.exe. `mcp-use build` prints the output path with one separator style instead of `.mcp-use\build/index.js`.
