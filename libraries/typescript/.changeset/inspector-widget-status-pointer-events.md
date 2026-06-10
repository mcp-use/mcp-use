---
"@mcp-use/inspector": patch
---

fix(inspector): stop widget status labels from blocking iframe pointer events

The MCP Apps preview pane rendered the invoking/invoked status label in an
absolutely positioned wrapper with `h-full`, which intercepted hover, click,
and form control interactions in a vertical strip along the left edge of the
widget iframe for the entire lifetime of the panel.

Apply `pointer-events-none`, drop the full-height wrapper, and align the Apps
SDK status label with the same non-blocking behavior.

Closes #1678
