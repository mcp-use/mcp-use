---
"@mcp-use/cli": patch
---

`mcp-use deploy --no-github` now applies every `.gitignore` that Git would: the ones in parent directories up to the repository root and the ones in nested directories, not only the deployed directory's own file. Files ignored there, such as keys or credentials in a monorepo app, are no longer uploaded.
