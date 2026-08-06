---
"@mcp-use/cli": patch
"mcp-use": patch
---

Move the CLI implementation and its tests into `@mcp-use/cli` while preserving the existing `mcp-use` command and server API. The standalone package now exposes `mcp-use-cli` as its executable so installing it alongside the framework cannot replace the framework command.
