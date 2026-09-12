---
"@mcp-use/client": patch
---

Fix `defaultRequestOptions` applying only to the initial tool fetch. The option is documented as the request options helper methods use, overridable per call, but every method except `initialize` passed the caller's options straight through, so omitting them dropped the configured timeout and cancellation settings and used the SDK defaults instead.
