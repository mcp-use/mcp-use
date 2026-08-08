# Standalone MCP server beside Next.js

This example keeps the Next.js website and MCP server in one project while running them as **two independent processes**. It is the right topology when MCP needs its own port, container, scaling policy, or deployment lifecycle.

The MCP source imports both of these through the Next.js project's `@/*` TypeScript alias:

- `@/lib/project-service`, a service also called by the page that imports `server-only` and `next/headers`
- `@/components/StatusCard`, a browser-safe React component also rendered by the page

No mcp-use configuration file is required. The generic CLI reads the project `tsconfig.json`, discovers the exported server and views under `src/mcp`, builds the views, and owns the standalone HTTP listener.

## Install in an existing application

From the root of a Next.js application:

```bash
pnpm add mcp-use zod
```

Use this layout (an app without `src/` can use the same pattern at its project root):

```text
src/
├── app/
│   └── page.tsx
├── components/
│   └── StatusCard.tsx
├── lib/
│   └── project-service.ts
└── mcp/
    ├── server.ts
    └── views/
        └── project-status/
            └── view.tsx
```

The server module must default-export its `MCPServer`. Do not call `listen()`; `mcp-use dev` and `mcp-use start` own the socket:

```ts
// src/mcp/server.ts
import { MCPServer } from "mcp-use";

const server = new MCPServer({
  name: "my-next-app",
  version: "1.0.0",
});

// Register tools and views here.

export default server;
```

Add separate scripts for the two processes:

```json
{
  "scripts": {
    "next:dev": "next dev --port 3000",
    "next:build": "next build",
    "next:start": "next start --port 3000",
    "mcp:dev": "mcp-use dev --mcp-dir src/mcp --port 3001",
    "mcp:build": "mcp-use build --mcp-dir src/mcp",
    "mcp:start": "mcp-use start"
  }
}
```

This repository names the MCP scripts `dev`, `build`, and `start` so the shared example verifier can run them directly.

## Run the example

Install dependencies from `libraries/typescript`, then use two terminals in this directory:

```bash
# Terminal 1: the website
pnpm next:dev
```

```bash
# Terminal 2: the standalone MCP server
pnpm dev
```

Open `http://localhost:3000` for the Next.js landing page and connect an MCP client to `http://localhost:3001/mcp`. Calling `project-status` should return text from the shared service and open the shared `StatusCard` component as an MCP App view.

## Split monorepo layout

The same CLI is framework-agnostic and also supports an MCP entry outside the host application:

```text
apps/
├── web/                 # package.json, tsconfig.json, Next.js app
└── mcp/
    └── src/
        ├── server.ts
        └── views/
```

Run it from the workspace root with the Next.js application as the project context:

```bash
mcp-use dev \
  --path apps/web \
  --entry ../mcp/src/server.ts \
  --views-dir ../mcp/src/views \
  --port 3001
```

`--path` selects the project root used for `package.json`, `.env`, and `tsconfig.json`. `--entry` and `--views-dir` are resolved relative to that project root. The same flags work with `build`; after building, use `mcp-use start --path apps/web`.

## Runtime boundary

When the CLI detects a Next.js host project, it loads the Next.js environment cascade and provides compatibility shims for common server-only imports so shared modules can load. For example, `next/headers` returns empty headers and cookies in the standalone process. Those shims provide module compatibility, not the website user's request context; pass required identity or request data through MCP authentication and request context.

Views run in a browser iframe. They may import browser-safe components such as `StatusCard`, but they must not import Server Components, `server-only`, database clients, filesystem APIs, or `next/headers`. Fetch server data in the MCP tool and return it as `structuredContent`, as `project-status` does here.

## Verify

The repository verifier builds the MCP project, starts the production server, and uses `@mcp-use/client` to initialize a session, list tools, call `project-status`, and read the generated MCP App resource:

```bash
pnpm verify
```

The repository `build` script already builds both MCP and Next.js. To verify only the Next.js side independently:

```bash
pnpm next:build
```

Expected results:

- the MCP client lists `project-status`
- calling it mentions the shared project service
- its tool metadata points to a readable MCP App resource
- the Next.js production build renders the landing page with the same card component
