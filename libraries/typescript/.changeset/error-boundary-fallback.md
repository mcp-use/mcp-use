---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Add `fallback` and `onError` props to ErrorBoundary

The `ErrorBoundary` component now accepts an optional `fallback` prop (`ReactNode` or `(error: Error) => ReactNode`) for custom error UI, and an `onError` callback for error reporting. When no fallback is provided, the default red error card is shown (backward compatible).
