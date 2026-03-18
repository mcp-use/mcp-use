---
"mcp-use": minor
"@mcp-use/inspector": minor
"@mcp-use/cli": minor
---

Upgrade to Vite 8 with Rolldown bundler and fix all test failures

**Vite 8 upgrade:**
- Upgrade `vite` from v7.3.x to v8.0.0 across all packages and examples
- Upgrade `@vitejs/plugin-react` from v5 to v6 (Oxc-based transforms)
- Migrate `rollupOptions` to `rolldownOptions` in all vite configs
- Migrate `optimizeDeps.esbuildOptions` to `optimizeDeps.rolldownOptions`
- Remove deprecated `build.commonjsOptions` (no-op in Vite 8)
- Switch programmatic `minify: "esbuild"` to `minify: true` (Oxc minifier)
- Extract `loadConfigFile` from `config.ts` into `config-file.ts` to prevent `require("fs")` leaking into browser bundles

**Test fixes (35 pre-existing failures):**
- Telemetry tests: add `vi.resetModules()`, async flush for fire-and-forget tracking, `type: "ai"` on agent mocks, missing adapter methods
- response-helpers tests: update widget() assertions from `_meta["mcp-use/props"]` to `structuredContent` per SEP-1865
- HMR tests: add widget config markers, mock `registerPrompt`/`registerResource` on sessions, update error message assertions
- ai_sdk_compatibility test: fix `StreamEvent` import to `@langchain/core/tracers/log_stream`
- distributed-stream-routing test: use OS-assigned ports instead of fixed port to eliminate EADDRINUSE race condition
- browser-react-no-node-deps test: fix `execSync` → `execFileSync` call

**CI fix:**
- Quote glob in `test:unit` script (`'tests/integration/**'`) to prevent shell expansion that was causing unit tests to be silently skipped in CI
- Add missing dev dependencies: `ai`, `morgan`, `@types/morgan`, `express-rate-limit`
