---
"@mcp-use/cli": patch
---

`mcp-use start --path <dir>` serves built view assets and `public/` files when run from another directory. Previously the production server looked for them under the current directory, so every view's JavaScript and CSS returned 404 and views rendered blank; without a `landing.tsx`, `public/` files returned 404 too.
