---
"mcp-use": patch
"@mcp-use/inspector": patch
"@mcp-use/cli": patch
---

Security: Fixed 13 vulnerabilities (3 moderate, 10 high)

- Updated `langchain` to `^1.2.3` (fixes serialization injection vulnerability)
- Updated `@langchain/core` to `^1.1.8` (fixes serialization injection vulnerability)
- Updated `react-router` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
- Updated `react-router-dom` to `^7.12.0` (fixes XSS and CSRF vulnerabilities)
- Added override for `qs` to `>=6.14.1` (fixes DoS vulnerability)
- Added override for `preact` to `>=10.28.2` (fixes JSON VNode injection)
