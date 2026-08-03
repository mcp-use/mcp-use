---
"@mcp-use/inspector": patch
---

Fix managed chat OAuth forwarding and polish chat UI.

**@mcp-use/inspector**
- Fix server-side chat for OAuth MCP servers (e.g. Linear): forward live connection tokens when saved auth config is `none`, so hosted chat no longer 401s while Tools stay connected.
- Add a top scroll fade on the chat message list so content softens under the floating header when scrolling.
- Center the Manufact cloud / API key tabs in Configure Chat and tighten spacing below them.
