---
"mcp-use": minor
"@mcp-use/cli": minor
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
---

Migrated mcp-use server from Express to Hono framework to enable edge runtime support (Cloudflare Workers, Deno Deploy, Supabase Edge Functions). Added runtime detection for Deno/Node.js environments, Connect middleware adapter for compatibility, and `getHandler()` method for edge deployment. Updated dependencies: added `hono` and `@hono/node-server`, moved `connect` and `node-mocks-http` to optional dependencies, removed `express` and `cors` from peer dependencies.

Added Supabase deployment documentation and example templates to create-mcp-use-app for easier edge runtime deployment.
