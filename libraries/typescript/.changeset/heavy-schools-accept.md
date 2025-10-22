---
'@mcp-use/inspector': patch
---

The main changes ensure that the proxy does not request or forward compressed responses and that problematic headers are filtered out when forwarding responses.
