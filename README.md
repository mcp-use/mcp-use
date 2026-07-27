<div align="center">
  <a href="https://mcp-use.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./static/logo_white.svg">
      <source media="(prefers-color-scheme: light)" srcset="./static/logo_black.svg">
      <img alt="mcp-use" src="./static/logo_black.svg" width="60%">
    </picture>
  </a>

  <h1>Build MCP servers and apps that run anywhere.</h1>

  <p>
    The TypeScript framework for building, testing, and shipping MCP on the official v2 SDK:
    typed tools, interactive apps, a built-in Inspector, and stateless HTTP.
  </p>

  <p>
    <a href="https://mcp-use.com/docs/typescript/getting-started/quickstart"><strong>Documentation</strong></a>
    · <a href="https://inspector.mcp-use.com/inspector"><strong>Inspector</strong></a>
    · <a href="#examples"><strong>Examples</strong></a>
    · <a href="https://manufact.com"><strong>Deploy</strong></a>
  </p>

  <p>
    <a href="#start-with-code"><strong>Start with code</strong></a>
    · <a href="#start-with-your-agent"><strong>Start with your agent</strong></a>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/mcp-use">
      <img src="https://img.shields.io/npm/v/mcp-use/beta.svg?label=v2%20beta" alt="mcp-use v2 beta">
    </a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/mcp-use/mcp-use" alt="MIT license">
    </a>
    <a href="https://discord.gg/XkNkSkMz3V">
      <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" alt="Discord">
    </a>
  </p>
</div>

> [!NOTE]
> **mcp-use v2 for TypeScript is in beta.** The examples below intentionally use the npm `beta` tag and require Node.js **22.22.2 or newer**. Python and the stable TypeScript v1 packages remain available through the [ecosystem links](#ecosystem).

## Choose how you build

Start from the terminal or give the same job to your coding agent. Both paths produce a typed MCP server with an interactive app, local Inspector, verification loop, and production deployment.

### Start with code

```bash
npx -y create-mcp-use-app@beta my-mcp-app --template mcp-apps --install --skills
cd my-mcp-app
npm run dev
```

Your MCP endpoint is now available at [`http://localhost:3000/mcp`](http://localhost:3000/mcp), with the Inspector at [`http://localhost:3000/mcp/inspector`](http://localhost:3000/mcp/inspector).

[Read the TypeScript quickstart →](https://mcp-use.com/docs/typescript/getting-started/quickstart)

### Start with your agent

Paste this into Claude Code, Codex, Cursor, or any coding agent. It will ask what to build, set up the project, follow the mcp-use skill, verify the result, deploy it, and return the live URLs.

```text
Build and deploy an MCP app to Manufact Cloud for me.

Follow these steps in order. Do not report success until every required check and the deployment have succeeded.

1. Ask what MCP server or app I want to build. If I am not sure, recommend the example MCP Apps template so I can see a working interactive app, and use it unless I choose something else.

2. Inspect the current workspace before creating files. Treat it as an existing mcp-use project when package.json depends on "mcp-use" or the source imports MCPServer from "mcp-use". Do not scaffold inside an existing mcp-use project or unrelated application.

3. Authenticate the v2 CLI:
   npx -y mcp-use@beta login

4. Install the mcp-apps-builder skill for the coding agents available in the workspace, then read and follow it:
   npx --yes skills add mcp-use/mcp-use --yes --skill mcp-apps-builder -a cursor -a claude-code -a codex

5. If this is a new project, scaffold it with the MCP Apps template and work inside the generated directory:
   npx -y create-mcp-use-app@beta my-mcp-app --template mcp-apps --install --skills
   If this is an existing mcp-use project, modify it in place instead.

6. Implement the tools and views we agreed on. Assign every statically declared tool to an exported constant. Keep model-facing content separate from view-facing structuredContent, and use typed output schemas for view-bound tools.

7. Verify the project before deploying:
   - Run npm run typecheck and npm run build.
   - Add @mcp-use/client@beta as a development dependency with the project's package manager, then start the server.
   - Connect with: npx mcp-use client connect local http://localhost:3000/mcp
   - List tools with: npx mcp-use client local tools list
   - Call representative tools with realistic inputs using: npx mcp-use client local tools call <tool-name> <key=value arguments>
   - For every interactive view, capture and inspect a screenshot using: npx mcp-use screenshot --server local --tool <tool-name> <key=value arguments> --output <name>.png
   - If a check fails, fix it and rerun the check. Never describe an interrupted, blocked, or failed check as passing.

8. Ask whether I want a Manufact-managed repository or my own GitHub account or organization.
   - For a Manufact-managed repository, deploy with:
     npx -y mcp-use@beta deploy --no-github --yes
   - For my own GitHub, ask which account or organization to use. Make sure the mcp-use GitHub App is installed there by opening https://github.com/apps/mcp-use/installations/new for me to authorize, push the project to a repository in that account or organization, then deploy with:
     npx -y mcp-use@beta deploy --yes

9. Wait for the deployment to reach a confirmed live state. If login, verification, build, or deployment is blocked or fails, stop and tell me exactly what needs attention.

10. When it is live, give me:
    - the MCP URL to connect clients; and
    - the Manufact Cloud dashboard URL for analytics, evals, observability, and logs.
```

This is the same public prompt contract used by Manufact Cloud. Cloud may insert a short-lived login code and an organization, but it does not change the build, verification, or deployment instructions. The README never contains personalized credentials.

## Why mcp-use v2

- **Scale like ordinary HTTP.** The v2 transport is stateless per request, so MCP traffic can use normal round-robin routing without protocol-level sticky sessions or shared session storage.
- **Keep tools and views typed together.** Exported tool references connect Zod input/output schemas to `useToolContext()` and `useCallTool()` in React.
- **Build interactive MCP Apps.** Return structured results that compatible clients such as ChatGPT and Claude can render as responsive application views.
- **Give humans and agents the same feedback loop.** Develop with hot reload, inspect visually, invoke tools from the terminal, capture view screenshots, and deploy from the same CLI.
- **Stand on the official SDK.** mcp-use v2 is built on the [official Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Quickstart: a typed MCP App

The scaffold gives you the server, TypeScript configuration, development scripts, Inspector, and a React view pipeline. Replace its `index.ts` with a view-bound tool like this:

```typescript
import { MCPServer } from "mcp-use";
import { z } from "zod";

const server = new MCPServer({
  name: "weather-app",
  title: "Weather App",
  version: "1.0.0",
});

const weatherInput = z.object({
  city: z.string().describe("City to look up"),
});

const weatherOutput = z.object({
  city: z.string(),
  temperature: z.number(),
  conditions: z.string(),
});

export const getWeather = server.tool(
  {
    name: "get-weather",
    title: "Get weather",
    description: "Get the current weather for a city",
    inputSchema: weatherInput,
    outputSchema: weatherOutput,
    view: { name: "weather-card" },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ city }) => {
    const weather = {
      city,
      temperature: 22,
      conditions: "Sunny",
    };

    return {
      content: [
        {
          type: "text",
          text: `Weather in ${city}: ${weather.conditions}, ${weather.temperature}°C`,
        },
      ],
      structuredContent: weather,
    };
  },
);

export default server;
```

Assign statically declared tools to exported constants. The generated `mcp-env.d.ts` uses those `ToolRef` values to type the view and reject calls to tools that are not exported.

[Explore MCP server tools →](https://mcp-use.com/docs/typescript/server/tools)

## From tool to interactive app

Create `views/weather-card/view.tsx`. The directory name matches `view.name` on the tool:

```tsx
import { useCallTool, useToolContext } from "mcp-use/react";

export default function WeatherCard() {
  const view = useToolContext<"get-weather">();
  const refresh = useCallTool("get-weather");

  if (view.status === "pending") return <p>Checking the weather…</p>;
  if (view.status === "error") return <p>{view.error.message}</p>;

  const weather =
    refresh.data?.structuredContent ?? view.toolOutput;

  return (
    <main style={{ padding: 24 }}>
      <h2>{weather.city}</h2>
      <p>
        {weather.temperature}°C · {weather.conditions}
      </p>
      <button
        disabled={refresh.isPending}
        onClick={() => void refresh.callTool({ city: weather.city })}
      >
        {refresh.isPending ? "Refreshing…" : "Refresh"}
      </button>
      {refresh.error && <p>{refresh.error.message}</p>}
    </main>
  );
}
```

The model reads the concise `content` result. The view reads the typed `structuredContent` through `useToolContext()`, and `useCallTool()` can invoke exported server tools without duplicating their input or output types.

[Build your first MCP App →](https://mcp-use.com/docs/typescript/mcp-apps/quickstart)

## Build, inspect, deploy

| Stage | Human workflow | Agent-friendly workflow |
| --- | --- | --- |
| **Build** | `npm run typecheck` and `npm run build` | The same commands return explicit exit codes and compiler errors |
| **Inspect** | Open `http://localhost:3000/mcp/inspector` | Connect with `mcp-use client`, list tools, and invoke them from the terminal |
| **Verify views** | Run tools and inspect the rendered app | Capture a PNG with `mcp-use screenshot` and inspect the image |
| **Deploy** | Run `npm run deploy` | Use `mcp-use deploy --yes` and wait for a confirmed live state |

```bash
# Terminal verification against a running local server
npm install --save-dev @mcp-use/client@beta
npx mcp-use client connect local http://localhost:3000/mcp
npx mcp-use client local tools list
npx mcp-use client local tools call get-weather city=Tokyo
npx mcp-use screenshot \
  --server local \
  --tool get-weather \
  city=Tokyo \
  --output weather-card.png
```

Deploy to [Manufact Cloud](https://manufact.com) for managed builds, preview deployments, analytics, evals, observability, and logs:

```bash
npm run deploy
```

The same server can be hosted on standard Node.js infrastructure or adapted for [Vercel](./docs/typescript/server/deployment/vercel.mdx), [Cloudflare Workers](./docs/typescript/server/deployment/cloudflare-workers.mdx), [Railway](./docs/typescript/server/deployment/railway.mdx), [Bun](./docs/typescript/server/deployment/bun.mdx), [Deno](./docs/typescript/server/deployment/deno.mdx), [Supabase](https://docs.mcp-use.com/typescript/server/deployment/supabase), and other Fetch/Hono runtimes.

## Examples

Remix a complete MCP App, inspect the source, or deploy it as a starting point:

| Preview | App | What it demonstrates |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/mcp-use/mcp-chart-builder/main/repo-assets/demo.gif" alt="Chart Builder demo" width="280"> | [Chart Builder](https://github.com/mcp-use/mcp-chart-builder) | Structured data rendered as interactive charts · [Open demo](https://yellow-shadow-21833.run.mcp-use.com/mcp) |
| <img src="https://raw.githubusercontent.com/mcp-use/mcp-diagram-builder/main/repo-assets/demo.gif" alt="Diagram Builder demo" width="280"> | [Diagram Builder](https://github.com/mcp-use/mcp-diagram-builder) | Create and edit diagrams through MCP tools · [Open demo](https://lucky-darkness-402ph.run.mcp-use.com/mcp) |
| <img src="https://raw.githubusercontent.com/mcp-use/mcp-maps-explorer/main/repo-assets/demo.gif" alt="Maps Explorer demo" width="280"> | [Maps Explorer](https://github.com/mcp-use/mcp-maps-explorer) | Search, detail tools, and an interactive map view · [Open demo](https://super-night-ttde2.run.mcp-use.com/mcp) |

[Browse all TypeScript examples →](./libraries/typescript/packages/server/examples)

## Ecosystem

| Package | Use it for |
| --- | --- |
| [`mcp-use`](https://www.npmjs.com/package/mcp-use) | TypeScript v2 server framework, React views, and CLI |
| [`@mcp-use/client`](https://www.npmjs.com/package/@mcp-use/client) | Connect to MCP servers from Node.js, browsers, React, and sandboxes |
| [`@mcp-use/agent`](https://www.npmjs.com/package/@mcp-use/agent) | Build model-powered agents on top of MCP clients |
| [`@mcp-use/inspector`](https://www.npmjs.com/package/@mcp-use/inspector) | Inspect and debug MCP servers and apps |
| [`create-mcp-use-app`](https://www.npmjs.com/package/create-mcp-use-app) | Scaffold servers and interactive apps |
| [`mcp-use` for Python](https://pypi.org/project/mcp-use/) | Build Python MCP servers, clients, and agents |

- [TypeScript documentation](https://mcp-use.com/docs/typescript)
- [Python documentation](https://mcp-use.com/docs/python)
- [Inspector documentation](https://mcp-use.com/docs/inspector/index)
- [Agent documentation](https://mcp-use.com/docs/typescript/agent/index)
- [Client documentation](https://mcp-use.com/docs/typescript/client/index)

## Protocol conformance

<div align="center">
  <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml">
    <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/python-conformance.json" alt="Python MCP conformance">
  </a>
  <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml">
    <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/python-client-conformance.json" alt="Python MCP client conformance">
  </a>
  <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml">
    <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/typescript-conformance.json" alt="TypeScript MCP conformance">
  </a>
  <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml">
    <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/typescript-node-client-conformance.json" alt="TypeScript MCP client conformance">
  </a>
</div>

## Security and community

- [Security policy](./SECURITY.md)
- [Contribution guide](./CONTRIBUTING.md)
- [GitHub issues](https://github.com/mcp-use/mcp-use/issues)
- [Discord community](https://discord.gg/XkNkSkMz3V)
- [Manufact](https://manufact.com)
- [MIT license](./LICENSE)

## Contributors

Built by [Pietro](https://github.com/pietrozullo), [Luigi](https://github.com/pederzh), [Enrico](https://github.com/tonxxd), and the mcp-use community.

<a href="https://github.com/mcp-use/mcp-use/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mcp-use/mcp-use" alt="mcp-use contributors">
</a>
