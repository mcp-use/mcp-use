<div align="center">
<div align="center">
  <a href="https://mcp-use.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./static/logo_white.svg">
      <source media="(prefers-color-scheme: light)" srcset="./static/logo_black.svg">
      <img alt="mcp use logo" src="./static/logo_black.svg" width="60%" >
    </picture>
  </a>
</div>
&nbsp;

<p align="center">
    <a href="https://mcp-use.com/docs" alt="Documentation">
        <img src="https://img.shields.io/badge/mcp--use-docs-blue?labelColor=white" /></a>
    <a href="https://manufact.com" alt="Website">
        <img src="https://img.shields.io/badge/made by-manufact.com-blue" /></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
    <br/>
    <a href="https://mcp-use.com/docs/python" alt="Python docs">
        <img src="https://img.shields.io/badge/pyhton-docs-blue?labelColor=white&logo=python" alt="Badge"></a>
    <a href="https://pypi.org/project/mcp_use/" alt="PyPI Version">
        <img src="https://img.shields.io/pypi/v/mcp_use.svg"/></a>
    <a href="https://pypi.org/project/mcp_use/" alt="PyPI Downloads">
        <img src="https://static.pepy.tech/badge/mcp-use" /></a>
    <br/>
    <a href="https://mcp-use.com/docs/typescript" alt="Typescript Documentation">
        <img src="https://img.shields.io/badge/typescript-docs-blue?labelColor=white&logo=typescript" alt="Badge"></a>
    <a href="https://www.npmjs.com/package/mcp-use" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/mcp-use.svg"/></a>
    <a href="https://www.npmjs.com/package/mcp-use" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/mcp-use.svg"/></a>
    <br/>
</p>
</div>

##  About

  <b>mcp-use</b> is the fullstack MCP framework
  to build MCP Apps for ChatGPT / Claude & MCP Servers for AI Agents.

- **Build** with mcp-use SDK ([ts](https://www.npmjs.com/package/mcp-use) | [py](https://pypi.org/project/mcp_use/)): MCP Servers and MCP Apps
- **Preview** on mcp-use MCP Inspector ([online](https://inspector.mcp-use.com/inspector) | [oss](https://github.com/mcp-use/mcp-use/tree/main/libraries/typescript/packages/inspector)): Test and debug your MCP Servers and Apps
- **Deploy** on [Manufact MCP Cloud](https://manufact.com): Connect your GitHub repo and have your MCP Server and App up and running in production with observability, metrics, logs, branch-deployments, and more

## Documentation

Visit our [docs](https://mcp-use.com/docs) or jump to a quickstart ([TypeScript](https://mcp-use.com/docs/typescript/getting-started/quickstart) | [Python](https://mcp-use.com/docs/python/getting-started/quickstart))

### Skills for Coding Agents

> **Using Claude Code, Codex, Cursor or other AI coding agents?**
>
> **[Install mcp-use skill for MCP Apps](https://skills.sh/mcp-use/mcp-use/mcp-apps-builder)**

## Quickstart: MCP Servers and MCP Apps

### <img src="./static/typescript.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> TypeScript

Build your first MCP Server or MPC App:

```bash
npx create-mcp-use-app@latest
```

Or create a server manually:

```typescript
import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "my-server",
  version: "1.0.0",
});

server.tool({
  name: "get_weather",
  description: "Get weather for a city",
  schema: z.object({ city: z.string() }),
}, async ({ city }) => {
  return text(`Temperature: 72°F, Condition: sunny, City: ${city}`);
});

await server.listen(3000);
// Inspector at http://localhost:3000/inspector
```

[**→ Full TypeScript Server Documentation**](https://mcp-use.com/docs/typescript/server)

## MCP Apps

MCP Apps let you build interactive widgets that work across Claude, ChatGPT, and other MCP clients — write once, run everywhere.

**Server**: define a tool and point it to a widget:

```typescript
import { MCPServer, widget } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "weather-app",
  version: "1.0.0",
});

server.tool({
  name: "get-weather",
  description: "Get weather for a city",
  schema: z.object({ city: z.string() }),
  widget: "weather-display", // references resources/weather-display/widget.tsx
}, async ({ city }) => {
  return widget({
    props: { city, temperature: 22, conditions: "Sunny" },
    message: `Weather in ${city}: Sunny, 22°C`,
  });
});

await server.listen(3000);
```

**Widget**: create a React component in `resources/weather-display/widget.tsx`:

```tsx
import { useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propSchema = z.object({
  city: z.string(),
  temperature: z.number(),
  conditions: z.string(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display weather information",
  props: propSchema,
};

const WeatherDisplay: React.FC = () => {
  const { props, isPending, theme } = useWidget<z.infer<typeof propSchema>>();
  const isDark = theme === "dark";

  if (isPending) return <div>Loading...</div>;

  return (
    <div style={{
      background: isDark ? "#1a1a2e" : "#f0f4ff",
      borderRadius: 16, padding: 24,
    }}>
      <h2>{props.city}</h2>
      <p>{props.temperature}° — {props.conditions}</p>
    </div>
  );
};

export default WeatherDisplay;
```

Widgets in `resources/` are **auto-discovered** — no manual registration needed.

Visit [**MCP Apps Documentation**](https://mcp-use.com/docs/typescript/server/ui-widgets)

## Templates

Ready-to-use MCP Apps you can deploy in one click or remix as your own.

| Preview | Name | Tools | Demo URL | Repo | Deploy |
| --- | --- | --- | --- | --- | --- |
| ![Chart Builder](https://raw.githubusercontent.com/mcp-use/mcp-chart-builder/main/repo-assets/demo.gif) | Chart Builder | `create-chart` | [Open URL](https://yellow-shadow-21833.run.mcp-use.com/mcp) | [mcp-use/mcp-chart-builder](https://github.com/mcp-use/mcp-chart-builder) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-chart-builder&branch=main&project-name=mcp-chart-builder&port=3000&runtime=node&base-image=node%3A20) |
| ![Diagram Builder](https://raw.githubusercontent.com/mcp-use/mcp-diagram-builder/main/repo-assets/demo.gif) | Diagram Builder | `create-diagram`, `edit-diagram` | [Open URL](https://lucky-darkness-402ph.run.mcp-use.com/mcp) | [mcp-use/mcp-diagram-builder](https://github.com/mcp-use/mcp-diagram-builder) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-diagram-builder&branch=main&project-name=mcp-diagram-builder&port=3000&runtime=node&base-image=node%3A20) |
| ![Slide Deck](https://raw.githubusercontent.com/mcp-use/mcp-slide-deck/main/repo-assets/demo.gif) | Slide Deck | `create-slides`, `edit-slide` | [Open URL](https://solitary-block-r6m6x.run.mcp-use.com/mcp) | [mcp-use/mcp-slide-deck](https://github.com/mcp-use/mcp-slide-deck) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-slide-deck&branch=main&project-name=mcp-slide-deck&port=3000&runtime=node&base-image=node%3A20) |
| ![Maps Explorer](https://raw.githubusercontent.com/mcp-use/mcp-maps-explorer/main/repo-assets/demo.gif) | Maps Explorer | `show-map`, `get-place-details`, `add-markers` | [Open URL](https://super-night-ttde2.run.mcp-use.com/mcp) | [mcp-use/mcp-maps-explorer](https://github.com/mcp-use/mcp-maps-explorer) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-maps-explorer&branch=main&project-name=mcp-maps-explorer&port=3000&runtime=node&base-image=node%3A20) |
| ![Hugging Face Spaces](https://raw.githubusercontent.com/mcp-use/mcp-huggingface-spaces/main/repo-assets/demo.gif) | Hugging Face Spaces | `search-spaces`, `show-space`, `trending-spaces` | [Open URL](https://gentle-frost-pvxpk.run.mcp-use.com/mcp) | [mcp-use/mcp-huggingface-spaces](https://github.com/mcp-use/mcp-huggingface-spaces) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-huggingface-spaces&branch=main&project-name=mcp-huggingface-spaces&port=3000&runtime=node&base-image=node%3A20) |
| ![Recipe Finder](https://raw.githubusercontent.com/mcp-use/mcp-recipe-finder/main/repo-assets/demo.gif) | Recipe Finder | `search-recipes`, `get-recipe`, `meal-plan`, `recipe-suggestion` | [Open URL](https://bold-tree-1fe79.run.mcp-use.com/mcp) | [mcp-use/mcp-recipe-finder](https://github.com/mcp-use/mcp-recipe-finder) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-recipe-finder&branch=main&project-name=mcp-recipe-finder&port=3000&runtime=node&base-image=node%3A20) |
| ![Widget Gallery](https://raw.githubusercontent.com/mcp-use/mcp-widget-gallery/main/repo-assets/demo.gif) | Widget Gallery | `show-react-widget`, `html-greeting`, `mcp-ui-poll`, `programmatic-counter`, `detect-client` | [Open URL](https://wandering-lake-mmxhs.run.mcp-use.com/mcp) | [mcp-use/mcp-widget-gallery](https://github.com/mcp-use/mcp-widget-gallery) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-widget-gallery&branch=main&project-name=mcp-widget-gallery&port=3000&runtime=node&base-image=node%3A20) |
| ![Multi Server Hub](https://raw.githubusercontent.com/mcp-use/mcp-multi-server-hub/main/repo-assets/demo.gif) | Multi Server Hub | `hub-status`, `hub-config-example`, `audit-log` | [Open URL](https://soft-voice-4nxfi.run.mcp-use.com/mcp) | [mcp-use/mcp-multi-server-hub](https://github.com/mcp-use/mcp-multi-server-hub) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-multi-server-hub&branch=main&project-name=mcp-multi-server-hub&port=3000&runtime=node&base-image=node%3A20) |
| ![File Manager](https://raw.githubusercontent.com/mcp-use/mcp-file-manager/main/repo-assets/demo.gif) | File Manager | `open-vault`, `get-file`, `list-files` | [Open URL](https://muddy-pond-eyays.run.mcp-use.com/mcp) | [mcp-use/mcp-file-manager](https://github.com/mcp-use/mcp-file-manager) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-file-manager&branch=main&project-name=mcp-file-manager&port=3000&runtime=node&base-image=node%3A20) |
| ![Progress Demo](https://raw.githubusercontent.com/mcp-use/mcp-progress-demo/main/repo-assets/demo.gif) | Progress Demo | `process-data`, `fetch-report`, `delete-dataset`, `search-external`, `failing-tool` | [Open URL](https://crimson-river-pzsz1.run.mcp-use.com/mcp) | [mcp-use/mcp-progress-demo](https://github.com/mcp-use/mcp-progress-demo) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-progress-demo&branch=main&project-name=mcp-progress-demo&port=3000&runtime=node&base-image=node%3A20) |
| ![i18n Adaptive](https://raw.githubusercontent.com/mcp-use/mcp-i18n-adaptive/main/repo-assets/demo.gif) | i18n Adaptive | `show-context`, `detect-caller` | [Open URL](https://falling-grass-58yov.run.mcp-use.com/mcp) | [mcp-use/mcp-i18n-adaptive](https://github.com/mcp-use/mcp-i18n-adaptive) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-i18n-adaptive&branch=main&project-name=mcp-i18n-adaptive&port=3000&runtime=node&base-image=node%3A20) |
| ![Media Mixer](https://raw.githubusercontent.com/mcp-use/mcp-media-mixer/main/repo-assets/demo.gif) | Media Mixer | `generate-image`, `generate-audio`, `generate-pdf`, `get-report`, `get-html-snippet`, `get-xml-config`, `get-stylesheet`, `get-script`, `get-data-array` | [Open URL](https://wandering-breeze-nuipu.run.mcp-use.com/mcp) | [mcp-use/mcp-media-mixer](https://github.com/mcp-use/mcp-media-mixer) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-media-mixer&branch=main&project-name=mcp-media-mixer&port=3000&runtime=node&base-image=node%3A20) |
| ![Resource Watcher](https://raw.githubusercontent.com/mcp-use/mcp-resource-watcher/main/repo-assets/demo.gif) | Resource Watcher | `show-config`, `update-config`, `toggle-feature`, `list-roots` | [Open URL](https://fragrant-term-zmdks.run.mcp-use.com/mcp) | [mcp-use/mcp-resource-watcher](https://github.com/mcp-use/mcp-resource-watcher) | [![Deploy to mcp-use](https://cdn.mcp-use.com/deploy.svg)](https://mcp-use.com/deploy/start?repository-url=https%3A%2F%2Fgithub.com%2Fmcp-use%2Fmcp-resource-watcher&branch=main&project-name=mcp-resource-watcher&port=3000&runtime=node&base-image=node%3A20) |

---
### <img src="./static/python.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> Python

```bash
pip install mcp-use
```

```python
from typing import Annotated

from mcp.types import ToolAnnotations
from pydantic import Field

from mcp_use import MCPServer

server = MCPServer(name="Weather Server", version="1.0.0")

@server.tool(
    name="get_weather",
    description="Get current weather information for a location",
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
)
async def get_weather(
    city: Annotated[str, Field(description="City name")],
) -> str:
    return f"Temperature: 72°F, Condition: sunny, City: {city}"

# Start server with auto-inspector
server.run(transport="streamable-http", port=8000)
# 🎉 Inspector at http://localhost:8000/inspector
```

[**→ Full Python Server Documentation**](https://mcp-use.com/docs/python/server/index)

---

## Inspector

The mcp-use Inspector lets you test and debug your MCP servers interactively.

**Auto-included** when using `server.listen()`:

```typescript
server.listen(3000);
// Inspector at http://localhost:3000/inspector
```

**Online** when connecting to hosted MCP servers:
<br>
>Visit https://inspector.mcp-use.com

**Standalone**: inspect any MCP server:

```bash
npx @mcp-use/inspector --url http://localhost:3000/mcp
```

Visit [**Inspector Documentation**](https://mcp-use.com/docs/inspector/index)

---

## Deploy

Deploy your MCP server to production:

```bash
npx @mcp-use/cli login
npx @mcp-use/cli deploy
```

Or connect your GitHub repo on [manufact.com](https://manufact.com) — production-ready with observability, metrics, logs, and branch-deployments.

---

## Package Overview

This monorepo contains multiple packages for both Python and TypeScript:

### Python Packages

| Package     | Description                           | Version                                                                                 |
| ----------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| **mcp-use** | Complete MCP server and MCP agent SDK | [![PyPI](https://img.shields.io/pypi/v/mcp_use.svg)](https://pypi.org/project/mcp_use/) |

### TypeScript Packages

| Package                | Description                                     | Version                                                                                                         |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **mcp-use**            | Core framework for MCP servers, MCP apps, and MCP agents | [![npm](https://img.shields.io/npm/v/mcp-use.svg)](https://www.npmjs.com/package/mcp-use)                       |
| **@mcp-use/cli**       | Build tool with hot reload and auto-inspector   | [![npm](https://img.shields.io/npm/v/@mcp-use/cli.svg)](https://www.npmjs.com/package/@mcp-use/cli)             |
| **@mcp-use/inspector** | Web-based previewer and debugger for MCP servers              | [![npm](https://img.shields.io/npm/v/@mcp-use/inspector.svg)](https://www.npmjs.com/package/@mcp-use/inspector) |
| **create-mcp-use-app** | Project scaffolding tool                        | [![npm](https://img.shields.io/npm/v/create-mcp-use-app.svg)](https://www.npmjs.com/package/create-mcp-use-app) |

---

## Also: MCP Agent & Client

mcp-use also provides a full MCP Agent and Client implementation.

<details>
<summary>Build an AI Agent</summary>

### <img src="./static/python.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> Python

```bash
pip install mcp-use langchain-openai
```

```python
import asyncio
from langchain_openai import ChatOpenAI
from mcp_use import MCPAgent, MCPClient

async def main():
    config = {
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
            }
        }
    }

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client)

    result = await agent.run("List all files in the directory")
    print(result)

asyncio.run(main())
```

[**→ Full Python Agent Documentation**](./libraries/python/README.md#quick-start)

### <img src="./static/typescript.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> TypeScript

```bash
npm install mcp-use @langchain/openai
```

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent, MCPClient } from "mcp-use";

async function main() {
  const config = {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    },
  };

  const client = MCPClient.fromDict(config);
  const llm = new ChatOpenAI({ modelName: "gpt-4o" });
  const agent = new MCPAgent({ llm, client });

  const result = await agent.run("List all files in the directory");
  console.log(result);
}

main();
```

[**→ Full TypeScript Agent Documentation**](./libraries/typescript/README.md#-quick-start)

</details>

<details>
<summary>Use MCP Client</summary>

### <img src="./static/python.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> Python

```python
import asyncio
from mcp_use import MCPClient

async def main():
    config = {
        "mcpServers": {
            "calculator": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-everything"]
            }
        }
    }

    client = MCPClient.from_dict(config)
    await client.create_all_sessions()

    session = client.get_session("calculator")
    result = await session.call_tool(name="add", arguments={"a": 5, "b": 3})

    print(f"Result: {result.content[0].text}")
    await client.close_all_sessions()

asyncio.run(main())
```

[**→ Python Client Documentation**](./libraries/python/README.md#direct-tool-calls-without-llm)

### <img src="./static/typescript.svg" height="14" style="margin-right:4px; top:-1px; position:relative;" align="center" /> TypeScript

```typescript
import { MCPClient } from "mcp-use";

async function main() {
  const config = {
    mcpServers: {
      calculator: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
  };

  const client = new MCPClient(config);
  await client.createAllSessions();

  const session = client.getSession("calculator");
  const result = await session.callTool("add", { a: 5, b: 3 });

  console.log(`Result: ${result.content[0].text}`);
  await client.closeAllSessions();
}

main();
```

[**→ TypeScript Client Documentation**](./libraries/typescript/README.md#basic-usage)

</details>

---

## Conformance to Model Context Protocol

<div align="center">
    <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml" alt="Python MCP Conformance">
        <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/python-conformance.json" /></a>
    <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml" alt="Python MCP Client Conformance">
        <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/python-client-conformance.json" /></a>
    <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml" alt="TypeScript MCP Conformance">
        <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/typescript-conformance.json" /></a>
    <a href="https://github.com/mcp-use/mcp-use/actions/workflows/conformance.yml" alt="TypeScript MCP Client Conformance">
      <img src="https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/tonxxd/6edf670f0446dc9f7a1f32d6bfda2b70/raw/typescript-node-client-conformance.json" /></a>
</div>

---

## Community & Support

- **Discord**: [Join our community](https://discord.gg/XkNkSkMz3V)
- **GitHub Issues**: [Report bugs or request features](https://github.com/mcp-use/mcp-use/issues)
- **Documentation**: [mcp-use.com/docs](https://mcp-use.com/docs)
- **Website**: [manufact.com](https://manufact.com)
- **X.com**: Follow [Manufact](https://x.com/manufact)
- **Contributing**: See [CONTRIBUTING.md](https://github.com/mcp-use/mcp-use/blob/main/CONTRIBUTING.md)
- **License**: MIT © [MCP-Use Contributors](https://github.com/mcp-use/mcp-use/graphs/contributors)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=mcp-use/mcp-use&type=Date)](https://www.star-history.com/#mcp-use/mcp-use&Date)

---

## Contributors

Thanks to all our amazing contributors!

### Core Contributors

1. **Pietro** ([@pietrozullo](https://github.com/pietrozullo))
2. **Luigi** ([@pederzh](https://github.com/pederzh))
3. **Enrico** ([@tonxxd](https://github.com/tonxxd))

<br>

<a href="https://github.com/mcp-use/mcp-use/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mcp-use/mcp-use" />
</a>

---

<div align="center">
  <strong>Built with ❤️ by Manufact team and the mcp-use community</strong>
  <br/>
  <sub>San Francisco | Zürich</sub>
</div>
