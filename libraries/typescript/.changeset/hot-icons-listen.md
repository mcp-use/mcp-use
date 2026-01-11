---
"create-mcp-use-app": patch
"@mcp-use/inspector": patch
"mcp-use": patch
---

This release includes significant enhancements to OAuth flow handling, server metadata caching, and favicon detection:

**OAuth Flow Enhancements**
- Enhanced OAuth proxy to support gateway/proxy scenarios (e.g., Supabase MCP servers)
- Added automatic metadata URL rewriting from gateway URLs to actual server URLs
- Implemented resource parameter rewriting for authorize and token requests to use actual server URLs
- Added WWW-Authenticate header discovery for OAuth metadata endpoints
- Store and reuse OAuth proxy settings in callback flow for CORS bypass during token exchange
- Added X-Forwarded-Host support for proper proxy URL construction in dev environments

**Client Info Support**
- Added `clientInfo` configuration prop to `McpClientProvider` for OAuth registration
- Client info (name, version, icons, websiteUrl) is now sent during OAuth registration and displayed on consent pages
- Supports per-server client info override
- Inspector now includes client info with branding

**Server Metadata Caching**
- Added `CachedServerMetadata` interface for storing server name, version, icons, and other metadata
- Extended `StorageProvider` interface with optional metadata methods (`getServerMetadata`, `setServerMetadata`, `removeServerMetadata`)
- Implemented metadata caching in `LocalStorageProvider` and `MemoryStorageProvider`
- Server metadata is now automatically cached when servers connect and used as initial display while fetching fresh data
- Improves UX by showing server info immediately on reconnect

**Inspector Improvements**
- Added logging middleware to API routes for better debugging
- Simplified server ID handling by removing redundant URL decoding (searchParams.get() already decodes)
- Added X-Forwarded-Host header forwarding in Vite proxy configuration
- Enabled OAuth proxy logging for better visibility

**Favicon Detection Improvements**
- Enhanced favicon detector to try all subdomain levels (e.g., mcp.supabase.com → supabase.com → com)
- Added detection of default vs custom favicons using JSON API response
- Prefer non-default favicons when available
- Better handling of fallback cases

**Other Changes**
- Updated multi-server example with Supabase OAuth proxy example
- Added connectionUrl parameter passing for resource field rewriting throughout OAuth flow
- Improved logging and error messages throughout OAuth flow
