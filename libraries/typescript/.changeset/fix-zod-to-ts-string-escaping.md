---
"mcp-use": patch
---

Fix incomplete escaping when converting Zod string literals and enums to TypeScript type strings. Backslashes are now escaped before double quotes so generated `.d.ts` output remains valid when literal values contain `\` or `"`.
