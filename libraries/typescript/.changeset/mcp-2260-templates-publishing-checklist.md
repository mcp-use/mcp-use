---
"create-mcp-use-app": patch
"mcp-use": patch
---

fix(templates): make `starter` and `mcp-apps` score 100% on the publishing checklist (MCP-2260)

- `mcp-use`: the Apps SDK adapter now auto-derives `openai/widgetDescription` from the widget's `description` when it isn't set explicitly, so hosts (and the publishing checklist) always see a widget description.
- `create-mcp-use-app` (`starter`): `fetch-weather` now declares a `title` and an `outputSchema`, returning matching `structuredContent`.
- `create-mcp-use-app` (`mcp-apps`): `search-tools` and `get-fruit-details` now declare a `title`, and the `product-search-result` widget declares a `domain` (widget description is auto-derived from its `description`).
