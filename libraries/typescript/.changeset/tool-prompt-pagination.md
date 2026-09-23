---
"@mcp-use/client": patch
"@mcp-use/agent": patch
---

Follow `tools/list` and `prompts/list` pagination so the agent sees every tool and prompt, not just the first page.

`BaseConnector.listTools()`/`listPrompts()` returned only the first page and discarded `nextCursor`, so servers that paginate their catalog silently exposed only a subset of their tools/prompts to the model. Added `listAllTools()`/`listAllPrompts()` (mirroring the existing `listAllResources()`/`listAllSkills()`) that follow every cursor to completion, with opaque-cursor handling (an empty-string cursor continues; only an absent cursor ends iteration) and repeated-cursor cycle detection. The tools cache (populated on `initialize()` and on `tools/list_changed`), the LangChain/native agent adapters' prompt loading, and the AI SDK adapter now use the paginating variants.
