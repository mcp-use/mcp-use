---
"mcp-use": patch
---

Bump `hono` to `4.12.23` to address [CVE-2026-47674](https://github.com/advisories/GHSA-xrhx-7g5j-rcj5), where non-canonical IPv6 forms could bypass static deny rules in the `ip-restriction` middleware.
