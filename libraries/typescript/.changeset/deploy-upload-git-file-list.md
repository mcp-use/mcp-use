---
"@mcp-use/cli": patch
---

`mcp-use deploy --no-github` now lets Git choose the files to upload. Every ignore rule Git applies is honored, including `.gitignore` files in parent and nested directories, `.git/info/exclude`, and global excludes, so files ignored at a monorepo root are no longer uploaded. Outside a Git repository only the project's `.gitignore` applies, as before. A `.manufactignore` file excludes more paths and can bring back Git-ignored ones with `!`. Credential filename patterns (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_dsa`, `id_ecdsa`, and `id_ed25519`, including dot-suffixed SSH filenames) join `.env*` files on the list that is never uploaded. Deploys print how many files they send and which credential files they skipped, and the new `--dry-run` flag lists the files without uploading.

Git discovery errors now fail instead of silently weakening ignore rules. Uploads prune dependency/build/cache trees before listing ignored files, normalize nested repository paths, and skip files below symbolic-link directories. Dry runs validate source paths consistently with uploads. Empty uploads name skipped files, sizes round across unit boundaries, and oversized uploads fail before an upload is announced. Non-ASCII upload paths fail explicitly until the managed backend can read them without losing source files.
