---
"@mcp-use/client": patch
---

Forward `modelContent` from the `window.openai.setWidgetState` compatibility shim to the host as `ui/update-model-context`, so view model context reaches the Inspector Chat LLM. `privateContent` and `imageIds` stay in the view, and the setter still resolves on surfaces without model context.
