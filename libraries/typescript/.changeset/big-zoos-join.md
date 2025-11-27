---
"@mcp-use/inspector": patch
"mcp-use": patch
---

**Bug Fixes:**
- Fixed auto-connect proxy fallback behavior - now properly retries with proxy when direct connection fails
- Fixed connection config updates not applying when connection already exists
- Fixed connection wrapper not re-rendering when proxy config changes

**Improvements:**
- Auto-switch (proxy fallback) now automatically enabled during auto-connect flow
- Added automatic navigation to home page after connection failures
- Improved error messages for connection failures
- Enhanced state cleanup on connection retry and failure scenarios
