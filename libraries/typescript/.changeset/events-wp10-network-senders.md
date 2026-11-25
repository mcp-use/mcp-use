---
"mcp-use": patch
---

The OAuth proxy's client metadata document (CIMD) fetch now also refuses hosts that resolve to IPv4 TEST-NETs, `192.0.0.0/24`, the 6to4 relay range, 6to4 `2002::/16`, Teredo and the rest of `2001::/23`, `2001:db8::/32`, `3fff::/20`, `100::/64` and IPv4-compatible IPv6 addresses. The network checks moved to a shared module used by the upcoming MCP Events webhook senders.
