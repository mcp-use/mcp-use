---
"@mcp-use/cli": patch
---

fix(cli): exit cleanly after `client` subcommands so headless agents don't hang

Each `mcp-use client` subcommand spins up a fresh `MCPClient` + HTTP/SSE
transport per process invocation but never closed it before returning, so
the underlying socket kept the Node event loop alive and the CLI process
hung after `tools list`, `tools call`, `resources read`, etc. — making the
client unusable for headless / agent-driven flows.

Each one-shot subcommand now closes its in-memory sessions and exits at
the end. Long-running commands (`subscribe`, `interactive`) are unchanged
and still keep the loop alive until Ctrl+C / `quit`.
