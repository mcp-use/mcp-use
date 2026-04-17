---
"@mcp-use/cli": patch
---

Deploy: `git init` / `commit` / `push` no longer fail silently—mutating git commands throw with stderr, the first branch is normalized to `main` before push, and `git rev-parse HEAD` verifies a commit exists. `mcp-use deploy` catches these errors and prints hints for missing `user.name`/`user.email` and for rejected/non-fast-forward pushes. Commit messages are shell-quoted.
