---
"@mcp-use/agent": patch
---

Fix `RemoteAgent.run` rejecting successful responses whose body has no `error` field. Error messages from a body with `error` or `status: "error"` now show the error (object errors as JSON) instead of `[object Object]`, without repeating the "Remote agent execution failed:" prefix. Remove the "failed to initialize" check, which could never match.
