---
"@mcp-use/inspector": patch
---

chore(inspector): add E2E test suite, default port 3000 when not in dev, skip telemetry in test env, and data-testid for testability

**E2E Testing Infrastructure:**

- Added comprehensive Playwright-based E2E testing suite with full coverage for:
  - Chat functionality and message handling
  - Connection management and authentication flows (OAuth, API key, custom headers)
  - HMR (Hot Module Reload) for tools, prompts, and resources
  - UI widgets and lifecycle states
  - Command palette and debugger tools
- Created test fixtures for auth servers (OAuth mock, API key, custom headers)
- Implemented test helpers for connection, authentication, and debugger tools
- Added test matrix for parameterized test scenarios across multiple inspector modes
- Comprehensive E2E testing documentation in `tests/e2e/README.md`

**CI/CD Integration:**

- New GitHub Actions workflow (`.github/workflows/inspector-e2e.yml`) for automated E2E testing
- Tests run across multiple modes: mix (SSE + WebSocket), prod (HTTP only), builtin (no connection)
- Improved Playwright configuration with CI-optimized timeouts

**Testability Improvements:**

- Added `data-testid` attributes across 40+ UI components for reliable element selection:
  - Connection forms, server list, command palette
  - Chat interface, tool execution panels
  - Resources, prompts, and tools tabs
  - Elicitation and sampling displays
- Enhanced component accessibility for automated testing

**Server Improvements:**

- Changed default port from 3001 to 3000 for production builds (dev still uses 3001)
- Skip telemetry (PostHog/Scarf) when `NODE_ENV=test` or `MCP_USE_ANONYMIZED_TELEMETRY=false`
- Added `start-auth-servers.ts` utility for running authentication test servers

**Widget Testing:**

- Created widget examples for conformance testing (weather-display, status-card, display-info, apps-sdk-only-card)
- Enhanced widget props support in ToolResultDisplay
- Added delayed weather tool to conformance server for lifecycle testing

Commits: 03238f28, 836b760d, 6a76e51a, 0eb147dc, 116a3be4 (partial)
