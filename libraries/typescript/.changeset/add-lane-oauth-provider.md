---
"mcp-use": minor
---

Add `oauthLaneProvider` for authenticating MCP servers with Lane (getonlane.com). Verifies Lane access tokens and installs Lane's consent gate: application tools refuse until the agent runs `lane_register_session`, which performs the server-side token exchange and records a connection. Also registers `lane_session_info`, the `lane://auth-guide` resource, and the root-path protected-resource document. Exports from `mcp-use/oauth/lane`.

Lane allows anonymous initialization and tool listing while requiring a bearer for every tool call. Connections are keyed by subject and OAuth client ID so token refresh preserves registration; the registration token ID is retained for auditing.
