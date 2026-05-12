---
"@mcp-use/inspector": patch
---

fix(inspector): surface MCP server auth failures with a reconnect banner

When the hosted inspector's chat backend returned 401 because the
upstream MCP server rejected the user's OAuth token (e.g. Linear token
expired), the inspector previously threw a generic `HTTP error! status:
401` and the cloud response misleadingly pointed users at the Manufact
account login.

The chat now recognises the cloud's `{ error: "mcp_auth_required",
mcpServerUrl }` response and renders an inline banner above the input
("Reconnect to <server>") with a button that calls
`connection.authenticate()`. Reconnect refreshes the OAuth token in
localStorage; the banner clears on success and chat resumes.

Pairs with a cloud-side change that drops the misleading `loginUrl`
field from the 401 response.
