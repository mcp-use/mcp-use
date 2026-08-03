---
"mcp-use": patch
---

Print `[mcp-use] no type errors (<duration>ms)` when `mcp-use typecheck` passes. `tsc --noEmit` writes nothing on a clean project, so the command used to exit `0` with no output at all, which was indistinguishable from a hang or a silent failure. Failing runs are unchanged and still show only the compiler's own diagnostics.
