---
"mcp-use": patch
---

## Bug Fixes
- Fix session connectivity issues by properly handling initialization requests and cleaning up old sessions
- Fix DNS rebinding protection behavior - now correctly allows all origins in development mode for easier local testing
- Fix session management to properly close old sessions when initializing new ones
- Improve error handling for missing/invalid sessions with proper HTTP status codes per MCP spec

## New Features
- Add `/sse` endpoint in addition to `/mcp` for better compatibility with different client configurations
- Enhance `allowedOrigins` configuration with environment-aware defaults (allows all origins in development, requires explicit config in production)
- Add `sessionIdleTimeoutMs` configuration option for customizable session timeout (default: 5 minutes)

## Improvements
- Improve session lifecycle management with better cleanup and last-accessed tracking
- Enhance security documentation with detailed examples for development vs production configurations
- Add comprehensive examples in API reference for different server configuration scenarios
