---
"@mcp-use/client": patch
---

Code mode's VM executor no longer loses error details or fails the run when the executed code logs something. `console.error(e)` on a caught error used to log `{}` and now logs `Error: Boom`. Logging an object with a circular reference or a BigInt used to throw into the executed code and fail it; those values now appear as `"[Circular]"` and `"1n"`. Other objects are logged as the same pretty-printed JSON as before.
