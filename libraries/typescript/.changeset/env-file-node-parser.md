---
"@mcp-use/cli": patch
---

`mcp-use env push` and `mcp-use deploy --env-file` now parse the file with Node's dotenv parser, the one `mcp-use dev` and `mcp-use start` use. Quoted values with inline comments, `\n` escapes, multi-line values, and `export`-prefixed or quoted lines in `--env-file` now upload the same values they have locally.
