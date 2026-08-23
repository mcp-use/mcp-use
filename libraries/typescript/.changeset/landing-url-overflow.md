---
"mcp-use": patch
---

fix(server): truncate the hero URL on the landing page instead of overflowing past the copy button

On narrow (mobile) viewports the server URL is an unbreakable string that overflowed the pill-shaped box and reappeared beyond the copy button. The hero `.url-box` now truncates with an ellipsis (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`), keeping the full URL available via the copy button.
