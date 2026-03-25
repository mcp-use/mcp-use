---
"mcp-use": patch
---

Revert stripInternal tsconfig option and @internal annotations that broke tool handler type inference in downstream consumers. The peer dep fix for @mcp-use/inspector is the correct solution for pnpm type duplication.
