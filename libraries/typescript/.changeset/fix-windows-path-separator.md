---
"@mcp-use/cli": patch
---

fix: directory separator on Windows platform causing widgets build fail. Normalize Windows backslash path separators to forward slashes when building widget entry paths to ensure cross-platform compatibility.

