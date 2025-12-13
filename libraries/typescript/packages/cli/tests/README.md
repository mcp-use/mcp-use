# CLI Tests

This directory contains tests for the mcp-use CLI client.

## Test Structure

### Unit Tests

- **`session-storage.test.ts`**: Tests for session persistence and management
  - Session creation and retrieval
  - Active session management
  - Session updates and deletion
  - Multi-session handling

- **`format.test.ts`**: Tests for output formatting utilities
  - Table formatting
  - JSON formatting
  - Tool call result formatting
  - Resource content formatting
  - Schema formatting
  - Message formatting

### Integration Tests

- **`cli-integration.test.ts`**: End-to-end CLI command tests
  - Help command outputs
  - Session management commands
  - Connection handling
  - Error scenarios
  - Output format flags

## Running Tests

### All Tests

```bash
# From the CLI package directory
pnpm test

# Or from the root
pnpm --filter @mcp-use/cli test
```

### Specific Test Files

```bash
# Session storage tests
pnpm test session-storage

# Format tests
pnpm test format

# Integration tests
pnpm test cli-integration
```

### Watch Mode

```bash
pnpm test --watch
```

### Coverage

```bash
pnpm test --coverage
```

## Test Requirements

### Unit Tests

Unit tests have no external dependencies and can be run independently.

### Integration Tests

Integration tests spawn the actual CLI process and test real command execution. They:
- Use a temporary directory for test data
- Don't require external services
- Mock or skip tests that need a real MCP server

## Adding New Tests

### For New Commands

When adding a new CLI command, add tests to:

1. **`cli-integration.test.ts`**: Add integration test for the command
2. Create a new test file if the command has complex logic

### For New Utilities

When adding utility functions:

1. Add tests to the appropriate test file (e.g., `format.test.ts`)
2. Test edge cases and error conditions
3. Test with different input types

## Mock Data

Tests use realistic mock data structures that match MCP protocol types:

```typescript
// Example session config
const mockSession: SessionConfig = {
  type: "http",
  url: "http://localhost:3000/mcp",
  lastUsed: new Date().toISOString(),
  serverInfo: {
    name: "test-server",
    version: "1.0.0",
  },
};

// Example tool call result
const mockResult: CallToolResult = {
  content: [{ type: "text", text: "Result" }],
  isError: false,
};
```

## Continuous Integration

Tests are run automatically in CI/CD:
- On pull requests
- Before releases
- On main branch commits

## Debugging Tests

### Verbose Output

```bash
pnpm test --reporter=verbose
```

### Run Single Test

```bash
pnpm test -t "test name"
```

### Debug Mode

```bash
node --inspect-brk node_modules/.bin/vitest run
```

## Test Coverage Goals

- **Unit tests**: 80%+ coverage
- **Integration tests**: Cover all major command paths
- **Edge cases**: Test error conditions and invalid inputs

## Future Tests

Tests marked with `.todo()` indicate planned test coverage:
- Mock server integration tests
- Resource subscription tests
- Interactive mode tests
- Complex multi-session scenarios
