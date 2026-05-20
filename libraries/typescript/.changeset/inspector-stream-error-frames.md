---
"@mcp-use/inspector": patch
---

Surface AI-SDK data-stream `3:` error frames via a new `streamError` state on `useChatMessages`, instead of silently dropping them. Fixes the bug where provider errors (e.g. OpenRouter "Insufficient credits") returned mid-stream produced no UI feedback.
