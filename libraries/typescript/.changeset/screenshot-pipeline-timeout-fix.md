---
"mcp-use": patch
"@mcp-use/inspector": patch
---

Inject readiness postMessage signal into programmatic widgets so that the CLI and REPL screenshot pipeline can detect when rendering is complete, preventing timeouts on widgets that lack the full AppBridge SDK.
