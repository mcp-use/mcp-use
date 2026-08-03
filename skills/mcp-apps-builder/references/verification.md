# Verification

Run the smallest checks that prove the changed behavior, then expand for risky package or runtime changes.

## Static checks

```bash
npm run typecheck
npm run build
node .agents/skills/mcp-apps-builder/scripts/check-v2.mjs .
```

Use the project's package manager and scripts when they differ. Resolve every new type, lint, or package-boundary failure before handoff.

## Server and tool checks

Start the real development server, then drive it through the public MCP endpoint:

```bash
npm run dev
npx mcp-use client connect dev http://localhost:3000/mcp
npx mcp-use client dev tools list
npx mcp-use client dev tools call show-product id=item-1
```

Assert the tool's `structuredContent` matches its declared `outputSchema`. Exercise authenticated and error paths when changed.

## View checks

Call the rendering tool through Inspector or the CLI screenshot flow. Verify pending, ready, and error states; tool-driven interactions; theme behavior; sizing; and asset/CSP loading in the real iframe lifecycle.

```bash
npx mcp-use client dev tools call show-product id=item-1 --screenshot
```

Reload once to catch state and asset assumptions masked by hot reload.

## Package checks

When changing exports, dependencies, or packaging, pack the relevant package and install it in an empty temporary consumer. Import public entry points there. A workspace build cannot prove the published dependency boundary.

## Deployment boundary

Do not deploy merely to validate source changes. Test deployment only when explicitly requested; otherwise verify build artifacts and document the untested external boundary.
