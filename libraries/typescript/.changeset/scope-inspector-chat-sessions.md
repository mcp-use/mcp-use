---
"@mcp-use/inspector": patch
---

Give each Inspector chat session one id and one state record, so **New Chat** starts a fresh chat while an earlier one is still streaming. Session state, persistence, and OAuth retry now share that id: `ChatStorageProvider.createChat` accepts it via the new optional `id` param, and providers that already stored it should return the existing chat.
