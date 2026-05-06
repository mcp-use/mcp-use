---
"@mcp-use/inspector": minor
---

Add OpenRouter as a first-class provider in the inspector chat configuration.

Selecting "OpenRouter" lets users authenticate with a single OpenRouter API key and access models from multiple upstream providers (OpenAI, Anthropic, Google, etc.). Internally, OpenRouter requests reuse the OpenAI provider with an override base URL and the required `HTTP-Referer` / `X-Title` headers.
