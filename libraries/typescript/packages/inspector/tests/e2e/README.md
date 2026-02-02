# Inspector E2E Tests

End-to-end tests for the MCP Inspector using Playwright.

## Setup

Install Playwright browsers (required on first run):

```bash
npx playwright install
```

## Running Tests

### Development Mode (Default)

Tests run against the dev server (`pnpm dev`):

```bash
# Run all tests (headless)
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

### Production Mode

Tests run against the production build (`pnpm build` + `pnpm start`):

**Important:** Build the app first!

```bash
# Build the app
pnpm build

# Run tests against production build
pnpm test:e2e:prod

# Run production tests with UI
pnpm test:e2e:prod:ui
```

### Other Commands

```bash
# View test report
pnpm test:e2e:report

# Run with visible browser (headed mode)
pnpm test:e2e --headed
pnpm test:e2e:prod --headed
```

## Test Structure

- `setup.test.ts` - Smoke tests for basic inspector functionality
- `connection.test.ts` - Tests for server connection management
- `tools.test.ts` - Tests for MCP tool execution
- `fixtures/conformance-server.ts` - Helper to start real conformance server

Tests use the **real MCP conformance server** from `examples/server/features/conformance` instead of mocks.

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

Tests use the real MCP conformance server on port 3002:

**Before running tests, start the conformance server manually:**

```bash
cd packages/mcp-use/examples/server/features/conformance
pnpm build
pnpm start --port 3002
```

The conformance server provides:
- **Real implementation**: Uses actual `mcp-use/server` implementation
- **Full feature set**: Includes all conformance test tools, resources, and prompts
- **Tools**: `test_simple_text`, `test_image_content`, `test_error_handling`, etc.
- **Resources**: `test://static-text`, `test://static-binary`, template resources
- **Prompts**: Various test prompts with and without arguments

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

## Test Modes

The test suite supports two modes via the `TEST_MODE` environment variable:

### Development Mode (default)
- Uses: `pnpm dev` (Vite dev server + backend)
- Fast HMR for rapid development
- Source maps for debugging
- Automatically started by Playwright

### Production Mode
- Uses: `pnpm start` (production build)
- Tests the actual build output
- Catches production-only issues (minification, bundling)
- **Requires**: Run `pnpm build` first!

**Recommendation:** Test in both modes before releasing!

```bash
# Test dev mode
pnpm test:e2e

# Test production mode (build first!)
pnpm build && pnpm test:e2e:prod
```

## Configuration

See `playwright.config.ts` for configuration options.

Key settings:
- **Base URL**: `http://localhost:3000/inspector`
- **Timeout**: 30s default
- **Retries**: 2 in CI, 0 locally
- **Artifacts**: Screenshots and videos on failure only
- **Auto Server**: Automatically starts/stops dev or production server
