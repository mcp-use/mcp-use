---
"mcp-use": patch
---

- Fix session reinitialization by refactoring transport creation logic
- Add `autoCreateSessionOnInvalidId` config option (default: true) for seamless reconnection with non-compliant clients
- Add DEBUG mode logging with detailed request/response information via DEBUG environment variable
- Improve runtime detection for Deno and Node.js environments
