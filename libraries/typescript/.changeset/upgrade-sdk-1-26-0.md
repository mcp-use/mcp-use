---
"mcp-use": patch
"@mcp-use/inspector": patch
---

chore(deps): upgrade @modelcontextprotocol/sdk to 1.26.0

**Dependencies:**

- Updated `@modelcontextprotocol/sdk` from `^1.25.3` to `^1.26.0`
- Applied the same Zod 4 compatibility patch to SDK 1.26.0
- Removed old SDK 1.25.3 patch file

**Patch Details:**

The SDK still requires a patch to fix Zod 4 compatibility in the `zod-compat.js` module. The patch ensures that Zod 4 schemas use their instance methods (`schema.safeParse()`) instead of attempting to call non-existent top-level functions (`z4mini.safeParse()`).

This is a drop-in replacement upgrade with no breaking changes.
