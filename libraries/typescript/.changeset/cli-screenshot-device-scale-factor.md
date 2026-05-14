---
"@mcp-use/cli": minor
---

feat(cli): add `--device-scale-factor <n>` to `mcp-use client screenshot` (both ad-hoc and per-server forms) and `--screenshot-device-scale-factor <n>` to `mcp-use client <name> tools call` for capturing high-DPI widget screenshots (e.g. Retina-style 2x). Defaults to 1, so existing behavior is unchanged. Accepts fractional values; bounded to (0, 4].
