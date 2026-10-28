---
"@mcp-use/client": patch
---

`MCPClient.fromConfigFile` and `new MCPClient(path)` now read config files that start with a UTF-8 BOM, which Windows PowerShell 5.1 `Out-File -Encoding utf8` writes. They threw `SyntaxError: Unexpected token` before.
