---
"@mcp-use/inspector": minor
"mcp-use": minor
---

## New Features

- **OAuth Authentication System**: Complete OAuth 2.0 support with built-in providers (Auth0, WorkOS, Supabase, Keycloak) and custom provider configuration
- **OAuth Middleware & Routes**: Server-side OAuth flow handling with automatic token management and session persistence
- **OAuth Callback Component**: Inspector now includes OAuth callback handling for authentication flows
- **Context Storage**: New async local storage system for request-scoped context in servers
- **Response Helpers**: Utility functions for standardized HTTP responses and error handling
- **Runtime Detection**: Auto-detection utilities for Node.js, Bun, and Deno environments
- **Server Authentication Examples**: Added OAuth examples for Auth0, WorkOS, and Supabase

## Improvements

- **Enhanced useMcp Hook**: Improved connection management with better state handling and OAuth support
- **Enhanced Inspector Dashboard**: Added OAuth configuration UI and connection status indicators
- **Enhanced Browser Provider**: Better authentication flow handling with OAuth integration
- **Improved Auto-Connect**: Enhanced connection recovery and auto-reconnect logic
- **Enhanced Authentication Docs**: Comprehensive server-side authentication guide with OAuth setup instructions
- **Renamed Notification Example**: Cleaner naming convention (notification-example → notifications)
- **Enhanced Tool Types**: Improved type definitions for server-side tool handlers with context support
- **Enhanced HTTP Connectors**: Added OAuth token handling in HTTP transport layer

## Documentation

- Added server authentication guide
- Enhanced client authentication documentation with OAuth flows
- Added notification examples and usage patterns
- Updated useMcp hook documentation with OAuth configuration
