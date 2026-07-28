<div align="center">
  <a href="https://mcp-use.com">
    <img alt="mcp-use" src="./docs/logo/banner-mcp-use.webp" width="100%">
  </a>
  <br /><br />

<div id="user-content-toc">
  <ul align="center" style="list-style: none;">
    <summary>
      <h1>The TypeScript framework for MCP</h1>
    <h3>Build, test, and ship MCP servers, ChatGPT plugins, Claude connectors</h3>
    </summary>
  </ul>
</div>
  

  <p>
    Fully Typed, native Views and MCP Apps support, built-in Inspector and first class Agent experience.
  </p>

  <p>
    <a href="https://mcp-use.com/docs/typescript/getting-started/quickstart"><strong>Documentation</strong></a>
    · <a href="https://inspector.mcp-use.com/inspector"><strong>Inspector</strong></a>
    · <a href="#examples"><strong>Examples</strong></a>
    · <a href="https://manufact.com"><strong>Deploy</strong></a>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/mcp-use">
      <img src="https://img.shields.io/npm/v/mcp-use/beta.svg?label=npm&amp;color=orange" alt="npm beta version">
    </a>
    <a href="https://www.npmjs.com/package/mcp-use">
      <img src="https://img.shields.io/npm/dw/mcp-use.svg" alt="npm downloads">
    </a>
    <a href="https://manufact.com">
      <img src="https://img.shields.io/badge/made%20by-manufact.com-blue" alt="made by manufact.com">
    </a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/mcp-use/mcp-use" alt="MIT license">
    </a>
    <a href="https://discord.gg/XkNkSkMz3V">
      <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" alt="Discord">
    </a>
  </p>
  <br /><br />
</div>

> [!NOTE]
> **TypeScript v2 is in beta.** Use the npm `beta` channel with Node.js **22.22.2 or newer**. [Python and TypeScript v1 →](#ecosystem)
>
> **Migrating from v1?** Most existing v1 servers can upgrade to `mcp-use@beta` without code changes through the included compatibility layer. To get the full benefits of v2, we recommend migrating to the native v2 API.
>
> **Give it to your agent:**
>
> ```text
> Migrate this mcp-use project to v2 following
> https://docs.mcp-use.com/v2/server/migration
> ```
>
> [Read the migration guide →](https://docs.mcp-use.com/v2/server/migration)

## Get started

<table width="100%" style="width: 100%; table-layout: fixed;">
  <colgroup>
    <col width="50%">
    <col width="50%">
  </colgroup>
  <thead>
    <tr>
      <th width="50%">Start with code</th>
      <th width="50%">Start with your agent</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td width="50%" valign="top">
        <pre lang="bash"><code>npx -y create-mcp-use-app@beta # create an MCP app</code></pre>
        <p>Run <code>npm run dev</code> in the generated project.</p>
        <p>Open <a href="http://localhost:3000/mcp/inspector"><code>http://localhost:3000/mcp/inspector</code></a></p>
        <p><a href="https://mcp-use.com/docs/typescript/getting-started/quickstart">TS Docs</a></p>
      </td>
      <td width="50%" valign="top">
        <pre lang="text"><code>Build an MCP server: https://mcp-use.com/prompt.md</code></pre>
        <p><a href="https://mcp-use.com/prompt.md">Read the prompt →</a></p>
      </td>
    </tr>
  </tbody>
</table>

## Everything you need to ship MCP

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Fully typed</h3>
      <p>Zod schemas flow from tools to structured results, View props, and tool calls.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Native Views</h3>
      <p>Bind React Views directly to tools and ship interactive apps without custom extension wiring.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Agent-first and headless</h3>
      <p>Scaffold, invoke, inspect, screenshot, and deploy through your agent.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Built-in debugging tools</h3>
      <p>Inspect tools and Views in the browser or headlessly through the CLI.</p>
    </td>
  </tr>
</table>

## Quickstart

The scaffold gives you the server, TypeScript configuration, development scripts, Inspector, and a React view pipeline. Start it once and the MCP endpoint also serves a client-ready landing page with its connection URL and setup instructions.

Replace its `index.ts` with a view-bound tool like this:

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

[Explore MCP server tools →](https://mcp-use.com/docs/typescript/server/tools)

## Add Views to your tools

Create `views/weather-card/view.tsx`. The directory name matches `view.name` on the tool:

```tsx
import { useCallTool, useToolContext } from "mcp-use/react";

export default function WeatherCard() {
  const { status, toolOutput, toolInput } =
    useToolContext<"get-weather">();
  const refresh = useCallTool("get-weather");

  if (status === "pending") {
    return <p>Checking the weather in {toolInput?.city ?? "your city"}…</p>;
  }
  if (status === "error") return <p>Could not load the weather.</p>;

  const weather = refresh.data?.structuredContent ?? toolOutput;

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

<p align="center">
  <img src="./static/readme/chatgpt-hello-world.jpg" alt="Hello World MCP App rendered in a ChatGPT conversation" width="100%" />
  <br />
  <sub>Build interactive UI experiences within ChatGPT with mcp-use.</sub>
</p>

[Build your first MCP App →](https://mcp-use.com/docs/typescript/mcp-apps/quickstart)

## Build

Create the production build:

```bash
npm run build
```

## Inspect

Start development mode to serve the MCP endpoint at [`http://localhost:3000/mcp`](http://localhost:3000/mcp). The Inspector is automatically available at [`http://localhost:3000/mcp/inspector`](http://localhost:3000/mcp/inspector):

```bash
npm run dev
```

<p align="center">
  <img src="./static/readme/inspector-hello-world.jpg" alt="Hello World MCP App rendered in the mcp-use Inspector" width="100%" />
  <br />
  <sub>Invoke tools, validate inputs, and inspect interactive Views in the same development loop.</sub>
</p>

Start a tunnel from the Inspector UI or run `mcp-use dev --tunnel` to get a public URL for your local MCP server and test it with ChatGPT and Claude before deployment. [Learn more about tunneling →](https://docs.mcp-use.com/tunneling)

Inspect the same server headlessly from the terminal, invoke representative tools, and capture a View screenshot:

```bash
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

## Deploy

Ship to [Manufact](https://manufact.com) and get observability, analytics, evals, submission readiness, and Git-based preview environments for free.

```bash
npm run deploy
```

Prefer to run it yourself? Follow the [self-hosting guide →](https://mcpuse-codex-v1-v2-docs-split.mintlify.site/v2/typescript/server/deployment/runtime-patterns).

## How mcp-use compares

mcp-use builds on the official TypeScript SDK v2 and adds first-class Views, typed tool-to-UI contracts, an optimized stateless runtime, the Inspector, screenshot verification, agent-first CLI workflows, and deployment.

In our benchmark, mcp-use v2 reached **10,982 median operations per second** and used **74.4 MiB across 51 installed packages**.

```mermaid
block-beta
  columns 6

  metric["Metric"] mcp["mcp-use v2"] official["Official SDK v2*"] xmcp["xmcp"] skybridge["Skybridge"] handler["mcp-handler"]

  speed["Speed"] speedMcp["10,982 ops/s"] speedOfficial["8,050 ops/s"] speedXmcp["6,585 ops/s"] speedSkybridge["8,116 ops/s"] speedHandler["6,324 ops/s"]
  install["Clean install"] installMcp["74.4 MiB"] installOfficial["99.0 MiB"] installXmcp["121.9 MiB"] installSkybridge["137.5 MiB"] installHandler["388.0 MiB"]
  packages["Installed<br/>packages"] packagesMcp["51"] packagesOfficial["119"] packagesXmcp["171"] packagesSkybridge["300"] packagesHandler["130"]
  views["Views"] viewsMcp["✅"] viewsOfficial["◐ Extension"] viewsXmcp["✅"] viewsSkybridge["✅"] viewsHandler["❌"]
  nativeViews["Native Views<br/>on MCP 2026"] nativeViewsMcp["✅"] nativeViewsOfficial["❌"] nativeViewsXmcp["❌"] nativeViewsSkybridge["❌"] nativeViewsHandler["❌"]
  oauth["One-line<br/>OAuth adapters"] oauthMcp["✅"] oauthOfficial["◐ Primitives"] oauthXmcp["✅"] oauthSkybridge["✅"] oauthHandler["❌"]
  protocol["MCP 2026<br/>protocol"] protocolMcp["✅"] protocolOfficial["✅"] protocolXmcp["❌"] protocolSkybridge["❌"] protocolHandler["❌"]
  screenshot["Built-in View<br/>screenshot CLI"] screenshotMcp["✅"] screenshotOfficial["❌"] screenshotXmcp["❌"] screenshotSkybridge["❌"] screenshotHandler["❌"]
  tunnel["Built-in<br/>tunneling"] tunnelMcp["✅"] tunnelOfficial["❌"] tunnelXmcp["❌"] tunnelSkybridge["✅"] tunnelHandler["❌"]
  inspector["Built-in<br/>Inspector"] inspectorMcp["✅"] inspectorOfficial["❌"] inspectorXmcp["❌"] inspectorSkybridge["◐ Limited"] inspectorHandler["❌"]

  classDef label fill:#f6f8fa,stroke:#d0d7de,color:#1f2328,font-weight:bold
  classDef brand fill:#dcfce7,stroke:#16a34a,color:#166534,font-weight:bold
  classDef header fill:#f6f8fa,stroke:#d0d7de,color:#1f2328,font-weight:bold
  classDef value fill:#ffffff,stroke:#d0d7de,color:#1f2328
  classDef leader fill:#dcfce7,stroke:#16a34a,color:#166534,font-weight:bold
  classDef partial fill:#fff8c5,stroke:#d4a72c,color:#633c01,font-weight:bold
  classDef unavailable fill:#f6f8fa,stroke:#d0d7de,color:#6e7781

  class metric,speed,install,packages,views,nativeViews,oauth,protocol,screenshot,tunnel,inspector label
  class mcp brand
  class official,xmcp,skybridge,handler header
  class speedOfficial,speedXmcp,speedSkybridge,speedHandler,installOfficial,installXmcp,installSkybridge,installHandler,packagesOfficial,packagesXmcp,packagesSkybridge,packagesHandler value
  class speedMcp,installMcp,packagesMcp,viewsMcp,viewsXmcp,viewsSkybridge,nativeViewsMcp,oauthMcp,oauthXmcp,oauthSkybridge,protocolMcp,protocolOfficial,screenshotMcp,tunnelMcp,tunnelSkybridge,inspectorMcp leader
  class viewsOfficial,oauthOfficial,inspectorSkybridge partial
  class viewsHandler,nativeViewsOfficial,nativeViewsXmcp,nativeViewsSkybridge,nativeViewsHandler,oauthHandler,protocolXmcp,protocolSkybridge,protocolHandler,screenshotOfficial,screenshotXmcp,screenshotSkybridge,screenshotHandler,tunnelOfficial,tunnelXmcp,tunnelHandler,inspectorOfficial,inspectorXmcp,inspectorHandler unavailable
```

<sub>* Includes `@modelcontextprotocol/ext-apps`, Vite, and zod for an MCP Apps-capable stack.</sub>

**[Read the detailed benchmark report →](./benchmark.md)**

**Does mcp-use lock deployment to Manufact Cloud?**

No. Manufact Cloud is the managed path for deployment, analytics, evals, observability, and logs. To run the same stateless server on your own infrastructure, follow the [self-hosting guide →](https://mcpuse-codex-v1-v2-docs-split.mintlify.site/v2/typescript/server/deployment/runtime-patterns).

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
