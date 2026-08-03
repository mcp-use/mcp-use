# Embedded MCP server in Next.js

This App Router example deploys the website and MCP server as one Next.js application. Next.js owns the HTTP listener, and mcp-use is mounted at `/api/mcp` through a Route Handler.

It demonstrates:

- `greet`, a normal MCP tool
- `show-status-card`, a tool with an MCP App view
- `components/StatusCard.tsx`, rendered by both the landing page and MCP view
- `public/next-mark.svg`, loaded by the view from the Next.js public directory
- `withMcpUse`, which integrates view builds, nested assets, tracing, and CORS
- `createNextHandler`, which adapts an authored `MCPServer` to a Next.js route

Application code never imports `.mcp-use/build`. That directory is generated and remains an implementation detail.

## Run this example

Install dependencies from `libraries/typescript`, then run:

```bash
pnpm dev
```

Open `http://localhost:3000` for the landing page. Connect an MCP client to `http://localhost:3000/api/mcp`, call `show-status-card`, and confirm the same card component and Next.js public image render in the MCP App view.

## Add embedded MCP to an application

Install the public packages:

```bash
pnpm add mcp-use zod
```

Use this minimal layout:

```text
app/
├── api/mcp/[[...path]]/route.ts
└── page.tsx
components/
└── StatusCard.tsx
views/
└── next-status-card/
    └── view.tsx
mcp-server.ts
next.config.ts
public/
└── next-mark.svg
```

### 1. Export the server

`mcp-server.ts` defines and default-exports the server. Do not call `listen()` because Next.js owns the HTTP listener:

```ts
import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "my-next-app",
  version: "1.0.0",
  basePath: "/api/mcp",
});

// Register tools and views.

export default server;
```

The `view.name` on a tool matches its directory below `views/`; for example, `view: { name: "next-status-card" }` binds `views/next-status-card/view.tsx`.

### 2. Enable the Next.js adapter

Wrap the existing Next.js configuration:

```ts
import type { NextConfig } from "next";
import { withMcpUse } from "mcp-use/next";

const nextConfig: NextConfig = {};

export default withMcpUse(nextConfig, {
  entry: "./mcp-server.ts",
  basePath: "/api/mcp",
});
```

`withMcpUse` compiles views when `next dev` or `next build` starts, includes generated assets in Next.js output tracing, and configures the complete MCP route subtree for browser clients. Restart `next dev` after editing the MCP server or a view so the startup build runs again.

### 3. Add the Route Handler

Create `app/api/mcp/[[...path]]/route.ts`:

```ts
import server from "../../../../mcp-server";
import { createNextHandler } from "mcp-use/next";

export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);
```

The optional catch-all is required: MCP uses `/api/mcp`, while view bundles and public assets use nested `/api/mcp/_mcp-use/*` paths. Adjust the import for a `src/app` layout or project alias.

### 4. Use normal Next.js scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

No separate `mcp-use build` command and no generated-entry import are required in application source.

## Sharing components and public assets

The view imports `components/StatusCard.tsx`, which the landing page also imports. Keep shared view components browser-safe: they must not depend on Server Components, `server-only`, `next/headers`, database clients, or filesystem APIs.

Inside a view, use mcp-use's `Image` component for a file from Next.js `public/`:

```tsx
import { Image } from "mcp-use/react";

<Image src="/next-mark.svg" width={48} height={48} alt="Next.js example mark" />
```

The adapter maps that request to the MCP asset subtree so it works inside a cross-origin MCP host.

## Verify

Run the repository's end-to-end verifier:

```bash
pnpm verify
```

It builds the MCP/Next.js application, starts it on a free port, and uses `@mcp-use/client` to:

- initialize an MCP session at `/api/mcp`
- list `greet` and `show-status-card`
- call `greet` and assert its result
- read the `next-status-card` MCP App resource
- load the generated view entry and `next-mark.svg`
- assert cross-origin headers on the nested public asset

Also run `pnpm build` directly when changing the integration. A successful production build verifies that the generated view files are included in Next.js output tracing.
