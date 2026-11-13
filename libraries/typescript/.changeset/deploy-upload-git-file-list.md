---
"@mcp-use/cli": patch
---

`mcp-use deploy --no-github` now lets Git choose the files to upload. Every ignore rule Git applies is honored, including `.gitignore` files in parent and nested directories, `.git/info/exclude`, and global excludes, so files ignored at a monorepo root are no longer uploaded. Outside a Git repository only the project's `.gitignore` applies, as before. A `.manufactignore` file excludes more paths and can bring back Git-ignored ones with `!`. Private keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`, SSH keys) join `.env*` files on the list that is never uploaded. Deploys print how many files they send and which credential files they skipped, and the new `--dry-run` flag lists the files without uploading.
