---
"mcp-use": minor
---

## Elicitation Support

Added comprehensive elicitation support following MCP specification, enabling servers to request user input through clients.

### New Features

- **Simplified API**: `ctx.elicit(message, zodSchema)` and `ctx.elicit(message, url)` with automatic mode detection
- **Form Mode**: Collect structured data with Zod schema validation and full TypeScript type inference
- **URL Mode**: Direct users to external URLs for sensitive operations (OAuth, credentials)
- **Server-Side Validation**: Automatic Zod validation of returned data with clear error messages
- **Client Support**: Added `elicitationCallback` to MCPClient and `onElicitation` to React `useMcp` hook
- **Type Safety**: Return types automatically inferred from Zod schemas
- **Configurable Timeout**: Optional timeout parameter (default: no timeout, waits indefinitely like sampling)

### Improvements

- Reuses official SDK's `toJsonSchemaCompat` for Zod → JSON Schema conversion
- Automatic `elicitationId` generation for URL mode requests
- 5-minute default timeout for user interactions
- Defense-in-depth validation (client optional, server required)
- Backwards compatible with verbose API

### Documentation

- Added `/typescript/server/elicitation` - Server-side usage guide
- Updated `/typescript/client/elicitation` - Client-side implementation guide
- Added to docs navigation
- Comprehensive examples with validation scenarios

### Testing

- **Unit Tests**: 14 tests covering Zod conversion and validation (`tests/unit/server/elicitation.test.ts`)
- **Integration Tests**: 14 tests covering full client-server flow (`tests/integration/elicitation.test.ts`)
- **Manual Tests**: Basic functionality and comprehensive validation test suites
- **Total**: 28 automated tests + manual test suites
- **Status**: All tests passing ✅

### Examples

- Created `examples/server/elicitation/` with 4 working tools
- Included basic functionality test client
- Included comprehensive validation test client (7 scenarios)  
- Added timeout configuration examples
- All examples working
