---
"mcp-use": patch
---

Fix `useWidget` breaking Apps SDK-only widgets. The MCP Apps bridge remains the primary runtime, but `window.openai` (Apps SDK) is now used as a compatibility fallback when the bridge does not connect, instead of being dropped entirely. Previously, any widget iframe whose host only spoke the Apps SDK (e.g. a ChatGPT widget without MCP Apps support) stayed stuck on the loading spinner because `useWidget` ignored `window.openai` data. A connected MCP Apps bridge still always wins, so ChatGPT continues to use MCP Apps as the source of truth.
