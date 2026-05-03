---
"@mcp-use/inspector": patch
---

Add configurable Base URL support for OpenAI-compatible providers in the inspector chat.

The OpenAI provider now accepts an optional `baseUrl` field, allowing users to point the inspector chat at any OpenAI-compatible API (e.g. LM Studio at `http://localhost:1234/v1`, OpenRouter at `https://openrouter.ai/api/v1`). When left blank the default OpenAI endpoint (`https://api.openai.com/v1`) is used.
