---
"@mcp-use/client": patch
---

Code mode's VM executor now applies its timeout to the whole run, not only the synchronous part. The `timeout` was passed to `node:vm` alone, which stops counting at the first `await`, so code that awaited a slow tool ran past the limit and a tool call that never answered left `executeCode` pending forever. Both now return `error: "Script execution timed out"` once the timeout elapses, the same as a synchronous loop. `node:vm` cannot cancel pending async work, so the timed-out script itself keeps running in the background, as it already did while `executeCode` waited on it; the call now returns instead of waiting.
