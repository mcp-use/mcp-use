---
"@mcp-use/cli": patch
"mcp-use": minor
---

`mcp-use build` no longer needs the server's runtime secrets. The build evaluates the entry with `MCP_USE_PHASE=build`, and the new `isBuilding()` export of `mcp-use` lets module-scope code skip reading secrets or connecting to a database while building.

`mcp-use build` also exits when the build finishes. Before, an entry that opened a connection at module scope, such as a Redis client, kept the build process running after it had printed its result. A failed build or dev start also prints the cause of a refused connection, which it used to print as an empty line.
