---
"@mcp-use/agent": patch
---

fix(agent): `RemoteAgent.run` now reports the "Agent initialization failed on remote server" error when the server's error mentions "failed to initialize"; the previous check ran on `String(result)` and could never match
