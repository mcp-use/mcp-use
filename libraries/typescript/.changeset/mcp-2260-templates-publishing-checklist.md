---
"create-mcp-use-app": patch
"mcp-use": minor
---

feat(server): enforce `outputSchema` at the tool return position, and make templates score 100% on the publishing checklist (MCP-2260)

- `mcp-use`: a tool's `outputSchema` is now type-checked at the return position with no new API. Returning `object({...})` (or `widget({ props })`, whose props become the result's `structuredContent`) with a shape that does not match `outputSchema` is a compile-time error, while content-only helpers (`text()`, `markdown()`, `image()`, ...) are always allowed. This is achieved by typing content helpers as a new `ToolContentResult` (no `structuredContent`) and making `widget()` generic over its props. Note: returning `mix()` carrying structured content, or a raw object literal whose `structuredContent` does not match, against a tool that declares `outputSchema` now errors (use `object()` or align the shape).
- `mcp-use`: the Apps SDK adapter auto-derives `openai/widgetDescription` from the widget's `description` when it isn't set explicitly, so hosts (and the publishing checklist) always see a widget description.
- `create-mcp-use-app` (`starter`): `fetch-weather` declares a `title` and an `outputSchema`, returning matching `structuredContent` via `object()`.
- `create-mcp-use-app` (`mcp-apps`): `search-tools` and `get-fruit-details` declare a `title`, and the `product-search-result` widget declares a `domain` (widget description is auto-derived from its `description`).
