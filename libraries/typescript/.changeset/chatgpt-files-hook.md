---
"mcp-use": minor
---

Add a `useFiles()` React hook with the familiar v1 upload/download shape for ChatGPT file uploads and temporary download URLs. The isolated files channel feature-detects only the optional `window.openai.uploadFile` and `window.openai.getFileDownloadUrl` extensions and does not read or mutate widget state.
