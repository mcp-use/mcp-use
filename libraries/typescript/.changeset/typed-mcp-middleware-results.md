---
"mcp-use": minor
---

Make MCP operation middleware type-safe by method. Exact patterns now correlate request params, `next()`, and return values; list middleware receives typed `Tool[]`, `Resource[]`, or `Prompt[]` arrays; and global `mcp:*` middleware preserves downstream results without exposing a cross-method replacement escape hatch. Category wildcards remain available for observer events. Observer events gain the same method-specific context and completion result types. Low-level typed entry adapters are available from the package root for advanced composition.
