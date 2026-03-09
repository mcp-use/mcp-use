---
"@mcp-use/inspector": patch
---

Fix sandbox host derivation for cloud-embedded inspector pages. Apex hosts (e.g. manufact.com) now correctly resolve to sandbox-inspector.{domain} instead of sandbox-{domain}.
