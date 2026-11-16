---
"@mcp-use/cli": patch
---

Make `mcp-use screenshot --wait-for` match selectors inside the View. Before, it searched only the Inspector page, which cannot see into the View's iframe, so a selector from the View never matched and the command timed out with `browser_timeout`.
