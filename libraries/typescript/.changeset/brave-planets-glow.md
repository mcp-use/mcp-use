---
"@mcp-use/inspector": minor
---

feat(inspector): add stop functionality to inspector chat

- Export stop function from `useChatMessagesClientSide` hook and connect it to `abortControllerRef`
- Add `abortControllerRef` to `useChatMessages` hook
- Connect stop button to abort streaming responses
- Enable users to stop ongoing chat responses in the inspector

Co-authored-by: Joaquin Coromina <bjoaquinc@users.noreply.github.com>
