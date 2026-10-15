---
"@mcp-use/agent": patch
---

fix(agent): `RemoteAgent.run` no longer rejects successful responses whose body omits the `error` field, and reports the response body instead of `[object Object]` when `status` is `"error"` without a message
