---
"mcp-use": patch
---

feat(mcp-use): enhance health monitoring with dynamic authentication headers

- Added `getAuthHeaders` parameter to `startConnectionHealthMonitoring` for customizable authentication headers during health checks.
- Implemented logic to fetch and include authorization headers in the health check request, improving security and flexibility.
- Updated `useMcp` to provide a default implementation for `getAuthHeaders`, ensuring seamless integration with authentication providers.
- Modified middleware to allow HEAD requests without authentication, facilitating health checks and keep-alive functionality.