---
"mcp-use": patch
---

Fix TypeScript type errors when passing Express middleware to server.use(). Added proper type definitions to accept both Hono and Express middleware, with Express middleware automatically detected and adapted at runtime.
