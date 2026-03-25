---
"mcp-use": patch
---

Fix TypeScript type incompatibility when mcp-use is resolved as multiple pnpm peer-variant copies. Moved _trackClientInit from a class method to a standalone function so it no longer appears in .d.ts, eliminating nominal type conflicts across duplicate installations.
