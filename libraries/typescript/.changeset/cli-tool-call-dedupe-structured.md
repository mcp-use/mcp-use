---
"@mcp-use/cli": patch
---

fix(cli): stop printing tool results twice when servers return structuredContent

Per the MCP spec, a tool that returns `structuredContent` SHOULD also serialize
the same JSON into a `TextContent` block for backwards compatibility. The
client was rendering both, so every call to a structured-output tool printed
the JSON payload twice.

`mcp-use client <name> tools call ...` now treats `structuredContent` as the
canonical form: when it's present, duplicate `TextContent` blocks are
suppressed and only the structured JSON is shown. Non-text content blocks
(image, resource) are still rendered alongside the structured payload — they
carry information the structured form doesn't.
