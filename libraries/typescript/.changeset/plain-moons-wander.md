---
"@mcp-use/cli": patch
---

Trim `skills.directory` before resolving it. The blank check already tested the trimmed value, but the untrimmed string was passed to `resolve`, so `skills: { directory: " skills" }` resolved to a sibling directory with a leading space and no skills were discovered.
