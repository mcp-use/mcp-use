---
"mcp-use": patch
"@mcp-use/cli": patch
---

Add comprehensive test suite for Hot Module Replacement (HMR) functionality

**Testing Approach:**

Tests use minimal mocking, focusing on:
- Real `MCPServer` instances
- Actual console logs (the developer experience)
- Direct registration state inspection
- Light session mocking only for injection tests

This approach is more robust and less brittle than heavy mocking, as tests verify real behavior and won't break when SDK internals change.

**Test Coverage:**

**Unit Tests** (`tests/unit/server/hmr.test.ts` - 15 tests):
- Tool registration (add, update, inject)
- Prompt registration (add, inject)
- Resource registration (add, inject)
- Notification sending (tools/list_changed, prompts/list_changed, resources/list_changed)
- Entry methods (enable, disable, remove, update)
- Error handling for injection failures
- Graceful notification error handling

**Integration Tests** (`tests/integration/hmr-cli.test.ts`):
- End-to-end file change detection
- Tool addition via HMR
- Tool description updates
- Syntax error handling and recovery
- Connection persistence during HMR

**CLI Tests** (`packages/cli/tests/tsx-resolution.test.ts`):
- tsx binary resolution from package.json bin field
- Handling string and object bin formats
- Graceful error handling for missing bin field
- Preference for 'tsx' entry in object form

All tests include proper setup/teardown, mocking, and comprehensive assertions.
