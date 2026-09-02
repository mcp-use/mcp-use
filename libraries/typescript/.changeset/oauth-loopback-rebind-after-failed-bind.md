---
"@mcp-use/client": patch
---

Rebind the OAuth loopback listener after a failed bind. `startLoopback()` assigned `this.server` before `listen()` resolved, so a bind failure left a server that was never listening; the `if (this.server) return` guard then made every later authorization skip binding and hang until the auth timeout.
