---
"mcp-use": patch
---

Fix OAuth-protected `mcp-use dev` flows by normalizing `0.0.0.0` and `::` to `localhost` in the inspector's autoConnect URL, so it matches the resource metadata published by `getServerBaseUrl()` and passes the SDK's strict origin check.
