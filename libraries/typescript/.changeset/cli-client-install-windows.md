---
"@mcp-use/cli": patch
---

Install `@mcp-use/client` on Windows. When `mcp-use client` or `mcp-use screenshot` auto-installed the client SDK, `cmd.exe` stripped the `^` from the version range, so npm and pnpm looked for `@mcp-use/client@2.0.0-alpha.0`, which was never published, and the install always failed. On Windows each argument is now quoted and the package manager runs as one command string, which also removes Node's DEP0190 warning. macOS and Linux are unchanged.
