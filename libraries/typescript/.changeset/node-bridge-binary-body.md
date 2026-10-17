---
"mcp-use": patch
---

Keep binary request bodies intact under Node. `toWebRequest` decoded every request body as UTF-8 text, so bytes that aren't valid UTF-8, such as a file uploaded to a custom route, reached the handler replaced with U+FFFD. This affected `listen()`, `mcp-use start`, `mcp-use dev`, and `toNodeHandler`/`toWebRequest` from `mcp-use/node`. The body is now passed on as the bytes that were received.
