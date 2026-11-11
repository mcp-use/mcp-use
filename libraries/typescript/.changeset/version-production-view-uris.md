---
"mcp-use": patch
"@mcp-use/cli": patch
---

Automatically version production view resource URIs with the build ID, keeping tool metadata, tool results, registered resources, and OAuth view access consistent. Every replica of a build shares the same URI, and a new build gets a fresh host cache key. Development view URIs remain unversioned.
