---
"@mcp-use/cli": patch
---

On Windows, `mcp-use screenshot` now finds Microsoft Edge, which ships with Windows, Chrome installed under `Program Files (x86)`, and Brave. It used to check only two Chrome locations, so it failed with `chrome_not_found` on machines without them even though the error message lists Edge and Brave.
