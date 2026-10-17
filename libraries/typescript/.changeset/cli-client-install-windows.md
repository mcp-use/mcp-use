---
"@mcp-use/cli": patch
---

Install the right `@mcp-use/client` when `mcp-use client` or `mcp-use screenshot` auto-installs it. The CLI looked for its peer range in a package named `mcp-use`, but the code now lives in `@mcp-use/cli`, so every install fell back to `^2.0.0-alpha.0`. It now reads the range declared in `@mcp-use/cli`'s package.json, and the fallback is `^2.0.1`. On Windows, `cmd.exe` also stripped the `^` from the range, so npm and pnpm looked for the unpublished `2.0.0-alpha.0` and the install always failed. Each argument is now quoted and the package manager runs as one command string, which also removes Node's DEP0190 warning. macOS and Linux keep the direct spawn.
