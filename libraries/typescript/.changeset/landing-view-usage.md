---
"mcp-use": patch
---

Record anonymous landing page views in the SDK's usage telemetry. Each sampled HTML `GET` to the MCP endpoint sends a `landing.viewed` event that says whether the page is built-in or custom, whether it was served by a dev server, whether the page is public, and whether the user agent looks automated (a crawler, link unfurler, HTTP library, or missing user agent). The user agent itself is never sent. `MCP_USE_ANONYMIZED_TELEMETRY=false` turns it off along with the other usage events.
