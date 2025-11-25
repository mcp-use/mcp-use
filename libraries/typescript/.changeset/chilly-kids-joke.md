---
"create-mcp-use-app": minor
"@mcp-use/inspector": minor
"mcp-use": minor
"@mcp-use/cli": minor
---

## Features

- **Notifications**: Added bidirectional notification support between clients and servers. Clients can register notification handlers and servers can send targeted or broadcast notifications. Includes automatic handling of `list_changed` notifications per MCP spec.
- **Sampling**: Implemented LLM sampling capabilities allowing MCP tools to request completions from connected clients. Clients can provide a `samplingCallback` to handle sampling requests, enabling tools to leverage client-side LLMs.
- **Widget Build ID**: Added build ID support for widget UI resources to enable cache busting. Build IDs are automatically incorporated into widget URIs.
- **Inspector Enhancements**: Added notifications tab with real-time notification display and server capabilities modal showing supported MCP capabilities.

## Improvements

- **Session Management**: Refactored HTTP transport to reuse sessions across requests instead of creating new transports per request. Added session tracking with configurable idle timeout (default 5 minutes) and automatic cleanup. Sessions now maintain state across multiple requests, enabling targeted notifications to specific clients.
- Enhanced HTTP connector with improved notification handling and sampling support
- Added roots support in connectors and session API (`setRoots()`, `getRoots()`) for better file system integration
- Added session event handling API (`session.on("notification")`) for registering notification handlers
- Added server methods for session management (`getActiveSessions()`, `sendNotificationToSession()`) enabling targeted client communication
- Added comprehensive examples for notifications and sampling features
- Enhanced documentation for notifications and sampling functionality
