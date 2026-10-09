---
"@mcp-use/cli": patch
---

Preserve the server child's exit status in `mcp-use start` after bounded server and tunnel cleanup. Unexpected failures remain nonzero so process supervisors can restart the server; intentional SIGINT and SIGTERM shutdowns still exit successfully.
