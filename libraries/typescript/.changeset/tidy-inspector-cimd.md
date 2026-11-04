---
"@mcp-use/inspector": patch
"@mcp-use/client": patch
---

Enable Inspector OAuth connections to servers that support Client ID Metadata
Documents (CIMD) without dynamic client registration. HTTPS Inspectors serve
their own metadata; local Inspectors use the public hosted metadata endpoint
with an exact loopback callback for their port and mount path. Preserve explicit
OAuth client settings and dynamic registration for servers without CIMD.
