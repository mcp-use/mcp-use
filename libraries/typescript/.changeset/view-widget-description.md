---
"mcp-use": patch
---

Copy a tool view's `description` to `_meta["openai/widgetDescription"]` on the view resource, on both `resources/list` and `resources/read`, so ChatGPT gets a widget description without extra config. This restores the v1 behavior.
