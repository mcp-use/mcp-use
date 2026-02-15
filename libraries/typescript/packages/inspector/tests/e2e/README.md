# Inspector E2E Tests

End-to-end tests for the MCP Inspector using Playwright.

## Setup

Install Playwright browsers (required on first run):

```bash
npx playwright install
```

## Running Tests

### Automated Test Matrix (Recommended)

These commands automatically build and start the conformance server before running tests.

**Note:** Telemetry (Scarf and PostHog) is automatically disabled during test runs to prevent network errors and tracking.

```bash
# Built-in mode: Server dev with built-in inspector (port 3000, for HMR testing)
pnpm test:e2e:builtin

# Production mode: Built server (port 3002) + built inspector (port 3000)
pnpm test:e2e:prod

# Mix mode: Built server (port 3002) + dev inspector (port 3000)
pnpm test:e2e:mix
```

**What each mode tests:**

- **builtin**: Tests HMR (hot module reload) functionality with the server running in dev mode with built-in inspector on a single port
  - Skips: auth-flows tests, connection tests, setup tests (not applicable for single-port builtin mode)
- **prod**: Tests the full production build of both inspector and server, catching build/minification issues
  - Skips: auth-flows tests
- **mix**: Tests dev inspector against a built server (default testing mode, fastest iteration)
  - Skips: auth-flows tests

**Run specific test files or individual tests:**

You can pass additional arguments to run specific test files or individual tests:

```bash
# Run a single test file
pnpm test:e2e:mix tests/e2e/setup.test.ts

# Run a specific test within a file using -g (grep pattern)
pnpm test:e2e:mix tests/e2e/chat.test.ts -g "should send message"

# Run multiple tests matching a pattern
pnpm test:e2e:mix -g "should display"

# Run multiple test files
pnpm test:e2e:prod tests/e2e/setup.test.ts tests/e2e/connection.test.ts

# Pass additional Playwright flags (headed mode, debug, etc.)
pnpm test:e2e:builtin tests/e2e/hmr.test.ts --headed
pnpm test:e2e:mix tests/e2e/chat.test.ts --debug
```

**Note:** The `-g` or `--grep` flag filters tests by name. You can use partial matches or regex patterns.

**Note on HMR tests:**

HMR tests (`hmr.test.ts`) modify the conformance server source files during testing. The test runner automatically:

- Runs HMR tests serially with `--workers=1` to prevent file conflicts
- Restores modified files after tests complete (using `git restore`)
- This happens automatically when running `test:e2e:builtin` or when explicitly running `hmr.test.ts`

### Manual Testing (Advanced)

For manual control or debugging, you can run tests without the automated setup:

```bash
# Run all tests (headless) - requires manually started conformance server
pnpm test:e2e

# Run tests with UI (interactive)
pnpm test:e2e:ui

# Run tests in debug mode
pnpm test:e2e:debug

# Run specific test file
pnpm test:e2e tests/e2e/setup.test.ts

# Run tests in specific browser
pnpm test:e2e --project=chromium
pnpm test:e2e --project=firefox
pnpm test:e2e --project=webkit
```

**Note:** When running manual tests, you must start the conformance server first (see "Manual Conformance Server Setup" below).

### Other Commands

```bash
# View test report
pnpm test:e2e:report

# Run with visible browser (headed mode)
pnpm test:e2e --headed

# Generate test code via codegen
pnpm test:e2e:codegen
```

## Test Structure

- `setup.test.ts` - Smoke tests for basic inspector functionality
- `connection.test.ts` - Tests for server connection management
- `tools.test.ts` - Tests for MCP tool execution
- `fixtures/conformance-server.ts` - Helper to start real conformance server

Tests use the **real MCP conformance server** from `examples/server/features/conformance` instead of mocks.

### Elicitation Tests

`connection.test.ts` includes elicitation coverage for:

- `test_elicitation`: baseline form-mode elicitation flow
- `test_elicitation_sep1034_defaults`: default values for primitive fields
- `test_elicitation_sep1330_enums`: all SEP-1330 enum schema variants

The SEP-1330 test verifies inspector rendering and submission behavior for:

- `string + enum` (untitled single-select)
- `string + oneOf[{ const, title }]` (titled single-select)
- `string + enum + enumNames` (legacy titled enum)
- `array + items.enum` (untitled multi-select)
- `array + items.anyOf[{ const, title }]` (titled multi-select)

## Writing Tests

### Best Practices

1. **Clean State**: Each test starts with a clean localStorage and cookies
2. **Wait Strategies**: Use `waitForSelector` and `waitForResponse` instead of `waitForTimeout`
3. **Selectors**: Prefer semantic selectors (roles, labels) over brittle CSS selectors
4. **Assertions**: Use Playwright's built-in assertions for auto-retry behavior

### Example Test

```typescript
test("should display tools section", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const toolsSection = page.getByRole("link", { name: /tools/i });
  await expect(toolsSection).toBeVisible();
});
```

### Conformance Server

Tests use the **real MCP conformance server** from `examples/server/features/conformance` instead of mocks.

The conformance server provides:

- **Real implementation**: Uses actual `mcp-use/server` implementation
- **Full feature set**: Includes all conformance test tools, resources, and prompts
- **Tools**: `test_simple_text`, `test_image_content`, `test_error_handling`, etc.
- **Resources**: `test://static-text`, `test://static-binary`, template resources
- **Prompts**: Various test prompts with and without arguments

**Automated setup:** The `test:e2e:builtin`, `test:e2e:prod`, and `test:e2e:mix` commands automatically build and start the conformance server.

**Manual setup (only for manual testing):** If using `pnpm test:e2e` directly without the automated commands, start the conformance server manually:

```bash
cd packages/mcp-use/examples/server/features/conformance
pnpm build
pnpm start --port 3002
```

The server runs on port 3002 (inspector dev server runs on 3000) to avoid conflicts.

## CI Integration

Tests run automatically in CI with:

- Browser installation
- Dev server startup
- Test execution across Chromium, Firefox, and WebKit
- Artifact upload on failure (screenshots, videos, traces)

## Debugging

### Generate test code

Use Playwright's codegen to generate test code by interacting with the app:

```bash
pnpm test:e2e:codegen
```

### View traces

Traces are captured on first retry. View them with:

```bash
pnpm test:e2e:report
```

### Debug specific test

```bash
pnpm test:e2e:debug tests/e2e/setup.test.ts
```

## Test Matrix

The test suite supports multiple configurations via the `TEST_MODE` and `TEST_SERVER_MODE` environment variables:

### Built-in Mode (`TEST_SERVER_MODE=builtin-dev`)

- Server runs in dev mode with built-in inspector on port 3000
- Tests HMR (hot module reload) functionality
- Both server and inspector on same port
- Run with: `pnpm test:e2e:builtin`

### Production Mode (`TEST_MODE=production`, `TEST_SERVER_MODE=external-built`)

- Inspector: `pnpm start` (production build on port 3000)
- Server: Built conformance server on port 3002
- Tests actual production build output
- Catches production-only issues (minification, bundling)
- Run with: `pnpm test:e2e:prod`

### Mix Mode (`TEST_MODE=dev`, `TEST_SERVER_MODE=external-built`, default)

- Inspector: `pnpm dev` (Vite dev server on port 3000)
- Server: Built conformance server on port 3002
- Fast HMR for rapid development with source maps
- Most common mode for development
- Run with: `pnpm test:e2e:mix` or `pnpm test:e2e` (manual)

**Recommendation:** Test in all modes before releasing! Use the automated commands (`test:e2e:builtin`, `test:e2e:prod`, `test:e2e:mix`) which handle server setup automatically.

## Configuration

See `playwright.config.ts` for configuration options.

Key settings:

- **Base URL**: `http://localhost:3000/inspector`
- **Timeout**: 30s default
- **Retries**: 2 in CI, 0 locally
- **Artifacts**: Screenshots and videos on failure only
- **Auto Server**: Automatically starts/stops dev or production server
