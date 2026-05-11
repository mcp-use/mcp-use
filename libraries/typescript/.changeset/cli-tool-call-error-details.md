---
"@mcp-use/cli": patch
---

fix(cli): surface tool call error details in `client tools call`

Previously when a tool call returned `isError: true`, the CLI showed
only "✗ Tool execution failed" without making it clear that the
following content was the error message — and printed nothing at all
when the server returned no content. Both human users and agent
callers had no way to debug what went wrong.

The output now labels the error content explicitly ("Error details:"),
colors text content red, surfaces `structuredContent` when present,
and falls back to "(no error details provided by server)" if the
server returned neither. Connection-level failures (caught Errors)
now also print any attached `data` payload.
