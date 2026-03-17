---
"mcp-use": patch
"@mcp-use/cli": patch
---

fix: TypeGen crash with Zod v4 enum schemas

`zod-to-ts` assumed Zod v3 internal structure for `ZodEnum` (`_def.values`), which is `undefined` in Zod v4 where enum entries are stored as `_def.entries`. This caused `Cannot read properties of undefined (reading 'map')` during `mcp-use build` for any project using `z.enum()` with Zod v4. Added v4 fallback paths for `ZodEnum`, `ZodDiscriminatedUnion`, and null guards for `ZodUnion` and `ZodTuple`. Also fixed the CLI reporting success when type generation silently failed.
