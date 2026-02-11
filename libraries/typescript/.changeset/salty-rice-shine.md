---
"@mcp-use/inspector": patch
---

fix(chat): enhance message conversion logic to handle empty content and attachments

- Updated `convertMessagesToLangChain` to fall back on `m.parts` when `m.content` is empty, ensuring text is retrieved from streamed assistant messages.
- Modified `useChatMessages` to prioritize `m.parts` for message content, improving message handling consistency.
- Adjusted `handleChatRequestStream` to utilize `externalHistory` for better context management during agent interactions, preventing message duplication.
