---
"@mcp-use/inspector": patch
---

Chat now respects MCP `annotations.audience` on `ui/message` content from MCP Apps. Blocks whose audience omits `"user"` still reach the model but are no longer shown in the conversation, and a message that is entirely model-only no longer adds a user bubble or opens the fullscreen chat drawer. Unannotated messages render as before.
