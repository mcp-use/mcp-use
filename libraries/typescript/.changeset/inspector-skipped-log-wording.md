---
"mcp-use": patch
---

Clarify the "Inspector: Skipped in production" log so users don't try to pass `--with-inspector` to `mcp-use start`. The flag belongs to `mcp-use build`; the new log spells out the rebuild command.

Docs: added a short note under `start` in `cli-reference.mdx` pointing readers at `build --with-inspector` for production inspector access.
