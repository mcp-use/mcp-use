---
"@mcp-use/client": patch
---

`detectFavicon` no longer sends link-local, carrier-grade NAT, IPv6 private and mDNS hostnames to the favicon service, so internal addresses such as the cloud metadata endpoint or `printer.local` stay with the client.
