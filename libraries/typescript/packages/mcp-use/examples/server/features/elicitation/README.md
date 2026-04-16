# Elicitation Example Server

This example demonstrates elicitation support in MCP, showing how servers can request user input through clients using a simplified, type-safe API.

## Features

✨ **Simplified API**: Use `ctx.elicit(message, zodSchema)` or `ctx.elicit(message, url)`
🛡️ **Server-Side Validation**: Automatic Zod validation of returned data
🎯 **Type Safety**: Full TypeScript type inference from Zod schemas
📝 **Comprehensive Examples**: Form mode, URL mode, and validation demos
📚 **SEP-1330 Patterns**: Reference enum schema patterns for advanced elicitation clients

## Elicitation Modes

### Form Mode

Collects structured data from users with Zod schema validation. Use this for non-sensitive information like:

- User preferences
- Configuration options
- Form data

**Example**:

```typescript
const result = await ctx.elicit(
  "Please provide your info",
  z.object({
    name: z.string().default("Anonymous"),
    age: z.number().min(0).max(150),
  })
);
// result.data is typed as { name: string, age: number }
```

### URL Mode

Directs users to external URLs for sensitive interactions. **MUST** be used for:

- Authentication credentials
- API keys
- OAuth flows
- Any sensitive data

**Example**:

```typescript
const result = await ctx.elicit(
  "Please authorize GitHub access",
  "https://github.com/login/oauth/authorize?..."
);
```

### SEP-1330 Enum Patterns

For advanced enum schemas (titled options and multi-select), use the verbose form API:

```typescript
const result = await ctx.elicit({
  message: "Choose options",
  requestedSchema: {
    type: "object",
    properties: {
      untitledSingle: { type: "string", enum: ["option1", "option2"] },
      titledSingle: {
        type: "string",
        oneOf: [{ const: "v1", title: "First Option" }],
      },
      legacyEnum: {
        type: "string",
        enum: ["v1"],
        enumNames: ["First Option"],
      },
      untitledMulti: {
        type: "array",
        items: { type: "string", enum: ["option1", "option2"] },
      },
      titledMulti: {
        type: "array",
        items: { anyOf: [{ const: "v1", title: "First Choice" }] },
      },
    },
  },
});
```

The full conformance implementation for SEP-1330 lives in:
`examples/server/features/conformance/src/server.tsx` via `test_elicitation_sep1330_enums`.

## Running the Server

```bash
pnpm install
pnpm dev
```

The server will start on port 3000 by default.

## Available Tools

1. **collect-user-info** - Form mode with Zod schema and validation
2. **test_elicitation** - Conformance test tool (matches MCP test suite)
3. **authorize-service** - URL mode for OAuth-like flows
4. **test-required-validation** - Demonstrates required field validation

For expanded conformance coverage (including `test_elicitation_sep1034_defaults` and `test_elicitation_sep1330_enums`), see the conformance feature server at:
`examples/server/features/conformance/src/server.tsx`.

## Testing

### Basic Test

```bash
pnpm exec tsx test-client.ts
```

Tests basic elicitation functionality (form mode, URL mode).

### Validation Test

```bash
pnpm exec tsx test-validation.ts
```

Comprehensive validation testing:

- ✅ Valid data acceptance
- ✅ Invalid age (out of range) - rejected
- ✅ Missing required fields - rejected
- ✅ Invalid email format - rejected
- ✅ Wrong data types - rejected
- ✅ Default value handling
- ✅ Decline/cancel handling

## Server-Side Validation

The server automatically validates all form mode data:

```typescript
// Invalid age (exceeds max)
age: 200; // max is 150
// ❌ Rejected: "Too big: expected number to be <=150"

// Invalid email format
email: "not-an-email";
// ❌ Rejected: "Invalid email address"

// Wrong type
age: "twenty-five"; // should be number
// ❌ Rejected: "Invalid input: expected number, received string"

// Missing required field
username: undefined; // required, no default
// ❌ Rejected: "Invalid input: expected string, received undefined"
```

## Testing with MCP Inspector

1. Open http://localhost:3000/inspector
2. Connect to the server
3. Call any of the elicitation tools
4. The client will receive an elicitation request and should present it to the user

## Security Notes

⚠️ **Important**: Always use URL mode for sensitive data collection. Form mode data passes through the MCP client and should only be used for non-sensitive information.
