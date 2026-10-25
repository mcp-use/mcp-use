---
"mcp-use": patch
---

Make `ctx.sendLog()` honor the request's log level. It now goes through the SDK's request logger, so messages below the requested `io.modelcontextprotocol/logLevel` are dropped, and modern (2026-07-28) clients receive no log messages unless the request opts in with a log level, as the notifications guide describes. For legacy clients the SDK applies the level set with `logging/setLevel`, and sends every message when none is set.
