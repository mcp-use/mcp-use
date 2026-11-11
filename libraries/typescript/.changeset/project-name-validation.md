---
"create-mcp-use-app": patch
"@mcp-use/cli": patch
---

create-mcp-use-app now applies the same project name rule to the command-line argument as to the interactive prompt: letters, numbers, hyphens and underscores only. A name like `"my app"` is rejected with a suggestion (`my-app`) instead of creating a directory whose `cd` hint breaks when pasted into a shell. `mcp-use build` now prints the output path with one separator style, so Windows shows `.mcp-use\build\index.js` instead of `.mcp-use\build/index.js`.
