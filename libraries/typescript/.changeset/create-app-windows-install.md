---
"create-mcp-use-app": patch
---

Install dependencies on Windows. `--install` and the install prompt started npm and pnpm without a shell, which cannot run their `.cmd` shims, so the install step failed with `spawn npm ENOENT` and asked for a manual install. On Windows the package manager now runs through the shell; macOS and Linux are unchanged.
