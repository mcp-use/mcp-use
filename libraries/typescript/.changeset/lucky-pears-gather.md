---
"@mcp-use/agent": patch
---

Preserve non-text tool content when replaying `RunOptions.externalHistory`. Tool messages were converted with a helper that keeps only `.text`, so an image returned by a tool was silently dropped before the provider saw it, and an MCP result object was `JSON.stringify`d with its base64 buried in text. Tool content now goes through the same conversion the inspector path already used, and LangChain `image_url` blocks are mapped to the MCP `image` shape.
