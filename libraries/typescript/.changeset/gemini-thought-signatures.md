---
"@mcp-use/agent": patch
---

Gemini tool calls now keep the `thoughtSignature` the model returns and send it back on the next turn of the tool loop. Gemini 3 models reject a replayed function call without its signature, so any agent or inspector chat that called a tool failed on the following request with a 400.
