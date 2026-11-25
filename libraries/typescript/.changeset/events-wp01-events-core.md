---
"@mcp-use/events-core": major
---

Add `@mcp-use/events-core`, the MCP Events wire contract shared by the mcp-use server, client, Inspector and CLI. It has the SEP-3415 and ChatGPT-dialect wire types, the `openai@1` and `sep-3415@1` delivery profiles, the known-client table, error codes in all three numberings with `decodeEventsError`, subscription ids that equal the official TypeScript SDK's, Standard Webhooks signing and verification, webhook secrets, `Mcp-Name` and `Mcp-Param-*` header codecs, and a push notification dispatcher. It has no dependencies and runs on any runtime with WebCrypto. The contract is also published as JSON test vectors under `@mcp-use/events-core/vectors/`.
