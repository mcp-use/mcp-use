---
"@mcp-use/cli": patch
---

`mcp-use build` now builds for production when `NODE_ENV` is unset. Before, the dev server that evaluates the entry set `NODE_ENV=development` for the rest of the build, so views shipped React's development build, and server-side JSX compiled to `jsxDEV`, which fails under `mcp-use start`. The entry is therefore also evaluated with `NODE_ENV=production` during the build.
