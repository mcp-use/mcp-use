---
"@mcp-use/agent": patch
---

Fix `RemoteAgent.run` rejecting successful responses whose body has no `error` field. A 200 body like `{"result": "..."}` leaves `result.error` `undefined`, and the `!== null` check treated it as a failure; an absent `error` field now counts as no error, while real `error` values and `status: "error"` bodies still reject. Object `error` values stringify as JSON, primitive `error` values render unquoted, and a `status: "error"` body without an `error` payload falls back to the serialized response body instead of `undefined`.
