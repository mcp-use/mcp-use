---
"@mcp-use/agent": patch
---

OpenAI-compatible providers now tolerate a `baseUrl` that ends with a slash. Request paths are joined without a doubled separator, so a client configured with `baseUrl: "http://localhost:8000/v1/"` calls `/v1/chat/completions` instead of the invalid `/v1//chat/completions`.
