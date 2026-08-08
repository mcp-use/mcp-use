# Elicitation example

A small `mcp-use` project demonstrating both MCP elicitation modes:

- `deploy` requests typed, structured confirmation through form elicitation.
- `connect-service` asks the client to open an external authorization URL.

Both are ordinary tools. When input is missing, `ctx.elicit` produces an
`input_required` tool result. A capable client collects the input and retries
the original call; on that invocation, the same helper returns the response.

## Form elicitation

Pass a stable correlation key, the user-facing message, and a Standard Schema:

```ts
const confirmation = await ctx.elicit(
  "deployment-approval",
  `Deploy to ${environment}?`,
  z.object({
    approve: z.boolean(),
    note: z.string().optional(),
  })
);

if (confirmation.status === "required") {
  return confirmation.result;
}

if (confirmation.status !== "accept" || !confirmation.data.approve) {
  return {
    content: [{ type: "text", text: "Deployment not approved." }],
    isError: true,
  };
}

// Perform the deployment here, after accepted input is available.
```

The accepted `data` type is inferred from the schema. Accepted content is also
validated against it; invalid client data results in another `input_required`
round instead of reaching the side effect.

The key (`deployment-approval` above) must remain stable across retries. It
correlates the embedded request with its response. Advanced tools that need
several sequential rounds should also carry their current step in verified
`requestState`.

## URL elicitation

Pass a URL string instead of a schema:

```ts
const authorization = await ctx.elicit(
  "service-authorization",
  "Authorize access to GitHub",
  authorizationUrl
);

if (authorization.status === "required") {
  return authorization.result;
}

if (authorization.status !== "accept") {
  return {
    content: [{ type: "text", text: "Authorization cancelled." }],
    isError: true,
  };
}
```

Use URL mode for authentication, credentials, payment details, or other
sensitive interactions whose submitted values should stay on the external
site instead of passing through the model or MCP client. In a real
authorization flow, verify the callback and state on your backend; the
client's `accept` action alone is not proof that authorization succeeded.

## Run the example

From this directory, start the server:

```sh
pnpm dev
```

Connect an MCP client with form and URL elicitation support to
`http://localhost:3000/mcp`, then call either `deploy` or `connect-service`.

## Typecheck and build

```sh
pnpm typecheck
pnpm build
```
