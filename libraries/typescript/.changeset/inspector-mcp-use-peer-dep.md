---
"@mcp-use/inspector": minor
"mcp-use": patch
---

Move mcp-use from dependencies to peerDependencies in @mcp-use/inspector. This ensures consumers share a single copy of mcp-use types, fixing TS2322 errors caused by pnpm creating multiple peer-variant copies with nominally-incompatible private/protected class members. Also add stripInternal to mcp-use tsconfig and mark internal class members with @internal to reduce .d.ts surface area.
