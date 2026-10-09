---
"mcp-use": patch
---

Fix memory retention in v1 HTTP session handling. DELETE requests carrying a session ID now use the original stateful transport even without an SSE Accept header, so teardown actually releases the session. Rejected or interrupted initialization also releases registered references, closes allocated servers/transports, and removes partial session and stream state.
