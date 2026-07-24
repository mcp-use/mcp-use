---
"mcp-use": patch
---

Replace date-based `mcp-use client --protocol` values with `auto`, `legacy`,
and `modern`. The named modes select automatic negotiation, the legacy wire,
or the stateless and sessionless modern wire without fallback.
