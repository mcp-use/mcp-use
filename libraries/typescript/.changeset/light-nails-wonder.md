---
'@mcp-use/inspector': patch
'mcp-use': patch
---

Several major updates:

- `useMCP` now uses `BrowserMCPClient` (previously it relied on the unofficial SDK).
- Chat functionality works in the Inspector using client-side message handling (LangChain agents run client-side, not in `useMcp` due to browser compatibility limitations).
- Chat and Inspector tabs share the same connection.
- The agent in Chat now has memory (previously, it didn't retain context from the ongoing conversation).
- The client now uses the advertised capability array from the server to determine which functions to call.  
  Previously, it would call functions like `list_resource` regardless of whether the server supported them.
- Added PostHog integration in the docs.
- Improved error handling throughout the Chat tab and connection process.
- Fixed Apps SDK widget rendering with proper parameter passing.
