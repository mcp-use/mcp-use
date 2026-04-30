---
"mcp-use": minor
---

feat(server): add `MCP_DEBUG_LEVEL` env var with `info` / `debug` / `trace` levels for HTTP request logs

Replaces the previous all-or-nothing `DEBUG=1` behavior with three explicit verbosity levels:

- `info` (default): one compact line per request, e.g.
  `[19:44:56] POST /mcp [tools/call: greet] OK (1ms)`. Initialize lines now include the client `name/version` and the new short session id (`→ session=92c4e0b`); subsequent requests are prefixed with `sess=<short>`. JSON-RPC and tool errors are extracted from the response body and shown inline (`ERROR cannot divide by zero`).
- `debug`: same as `info` plus inline `args=<json>` for `tools/call`.
- `trace`: identical to the legacy `DEBUG=1` output (full request/response headers and bodies).

`DEBUG=1` (or any truthy `DEBUG` value) continues to work and maps to `trace`. Internal "Session initialized"/"Session closed" log lines are now suppressed at `info` level, since the per-request log line already conveys that information.
