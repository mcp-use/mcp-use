---
"@mcp-use/client": patch
---

Fix `listAllResources` throwing a raw `TypeError` when a disconnect lands between pages. The pagination loop read `this.client` once per page, so `disconnect()` clearing it mid-listing surfaced `Cannot read properties of null (reading 'listResources')` instead of the transport's own error.
