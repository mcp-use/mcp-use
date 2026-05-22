---
"@mcp-use/inspector": patch
---

Forward MCP image tool results as real image content to the model instead of base64-encoded JSON.

Previously, when an MCP tool returned an `image` content block, the inspector's chat would `JSON.stringify` the entire result — including the base64 `data` field — and hand that string to the LLM as the tool message body. Vision-capable models couldn't decode the embedded bytes, so they saw a blob of base64 text instead of the picture.

The conversion now extracts MCP `content` blocks into provider-neutral `ContentPart[]` and forwards image bytes through each provider's vision channel:

- **Anthropic**: image blocks are embedded inside `tool_result.content` as `{ type: "image", source: { type: "base64", media_type, data } }`.
- **OpenAI**: the `tool` role keeps a text summary; image bytes are forwarded as a follow-up `user` turn with `image_url` parts (the tool role can't carry images).
- **Google (Gemini)**: `functionResponse.response` keeps only a text/metadata summary; image bytes are forwarded as a follow-up `user` turn with `inlineData` parts.

Text-only tool results still take the legacy `content: string` path on every provider, so non-image tools are unaffected. Audio, resource, and resource-link blocks are summarized as text markers (audio bytes are not yet forwarded).

Note: text-only tool results now reach the model unwrapped (e.g. `"hi"`) instead of as JSON-wrapped `{"content":[{"type":"text","text":"hi"}]}`; on Gemini specifically, `functionResponse.response` is now `{ result: "hi" }` rather than the previous MCP-shaped object.
