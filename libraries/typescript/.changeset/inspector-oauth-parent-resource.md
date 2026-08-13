---
"@mcp-use/inspector": patch
---

Allow OAuth protected-resource metadata to advertise a resource on the same origin whose path is a segment-aware parent of the MCP endpoint, matching the official MCP TypeScript SDK compatibility policy. Root well-known discovery now validates against the root resource identifier, while cross-origin, sibling-path, credential-bearing, fragmented, and insecure non-loopback resource values remain rejected.
