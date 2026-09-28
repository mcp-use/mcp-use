---
"mcp-use": patch
"@mcp-use/client": patch
---

Views no longer stay pending forever when the host cancels the tool call that rendered them. When `ui/notifications/tool-cancelled` arrives before a result, `useToolContext()` now switches to `status: "error"` with a new `ToolCancelledError` (exported from `mcp-use/react`) that carries the host's `reason`. Views that already render `error.message` show the cancellation without changes. Check `error instanceof ToolCancelledError` to show a "Cancelled" state or a retry. A cancellation that arrives after a result is still ignored.

`ToolContextError` is now `ToolError | ToolCancelledError`. Narrow with `instanceof ToolError` before reading `error.result`.

`ViewRenderer` no longer sends `tool-cancelled` when a tool call made by the view fails. That failure already rejects the view's call, and the notification refers to the tool call that rendered the view.
