---
"@mcp-use/client": patch
---

Strip a leading UTF-8 BOM when loading a JSON config file so `MCPClient.fromConfigFile()` accepts configs written by tools such as PowerShell 5.1.
