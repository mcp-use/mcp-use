---
"@mcp-use/client": patch
---

Code mode no longer replaces sessions that are already connected. When any configured server had no session, `executeCode` called `createAllSessions()`, which recreates a session for every server and disconnects the previous one, so a stdio server you had already connected was restarted and the `MCPSession` you held stopped working. It now creates sessions only for the servers that are missing.
