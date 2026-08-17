# Verification

Run the smallest checks that prove the requested behavior, then expand for changes involving generated types, authentication, Views, package boundaries, or concurrency.

## Static checks

Use the project's package manager and scripts. For a typical project:

```bash
npx mcp-use typecheck
npm run typecheck
npm run build
```

Do not assume every project defines both typecheck commands. `mcp-use build` bundles and transpiles; it does not replace typechecking. Resolve new type, lint, package-boundary, and generated-registry failures before handoff.

## Server and capability checks

Start the actual development server, connect through its public MCP endpoint, and drive the changed capability:

```bash
npm run dev
npx mcp-use client connect dev http://localhost:3000/mcp
npx mcp-use client dev tools list
npx mcp-use client dev tools call lookup-inventory sku=item-1
```

For tools, test valid input, schema rejection, expected failures, and matching `structuredContent`. For resources, read static and templated URIs and exercise completion. For prompts, inspect the exact generated messages and suggestions. Exercise authorization and cancellation paths when changed.

## View checks

Render every affected View through its bound tool in the Inspector. Verify:

- Pending, ready, and error rendering.
- View-to-tool calls and host actions.
- Model-visible state versus ephemeral UI state.
- Theme, sizing, supported display modes, and accessibility.
- Public assets, external requests, CORS, runtime errors, and CSP.

Capture the real View with the screenshot command, not a `tools call` flag:

```bash
npx mcp-use screenshot --server dev --tool show-product id=item-1
```

## Advanced and packaging checks

- For Skills over MCP, verify the catalog, retrieve the Skill, read supporting files, and run a strict production build.
- For notifications, keep a listener active and confirm non-durable invalidation behavior.
- For elicitation, test required, accept, decline, cancel, invalid input, callback replay, and side-effect ordering.
- For proxying or OpenAPI, verify representative generated capabilities and documented unsupported boundaries.
- For export, dependency, or packaging changes, pack the package and install it in an empty temporary consumer; a workspace build cannot prove the published boundary.

Do not deploy merely to validate source changes. If deployment was not requested, verify local build artifacts and state the untested external boundary.
