---
"mcp-use": patch
---

Fix iframe collapse when widget renders null by allowing zero-height notifications

Previously, the `height > 0` guard in `McpUseProvider` prevent height notifications when a widget rendered `null`, causing the iframe to persist at its last non-zero height. This fix allows zero heights to pass through unconditionally while maintaining the threshold check for positive heights, enabling proper iframe collapse for empty widgets.
