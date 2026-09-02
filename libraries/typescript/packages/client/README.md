<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">@mcp-use/client</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mcp-use/client" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/@mcp-use/client.svg"/></a>
    <a href="https://www.npmjs.com/package/@mcp-use/client" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/@mcp-use/client.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use" /></a>
    <a href="https://github.com/mcp-use/mcp-use/stargazers" alt="GitHub stars">
        <img src="https://img.shields.io/github/stars/mcp-use/mcp-use?style=social" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

**MCP client** for connecting to [Model Context Protocol](https://modelcontextprotocol.io) servers — tools, resources, prompts, OAuth, and React hooks. Part of the [mcp-use](https://github.com/mcp-use/mcp-use) TypeScript framework.

> **Docs:** [Client overview](https://mcp-use.com/docs/typescript/client) · [API reference](https://mcp-use.com/docs/typescript/api-reference/client/mcp-client)

---

## Install

```bash
npm install @mcp-use/client
```

Node.js ≥ 22.22.2. For React hooks, install `react` as a peer dependency.

---

## Quick start (Node)

```typescript
import { MCPClient } from "@mcp-use/client";

const client = new MCPClient({
  mcpServers: {
    demo: { url: "http://localhost:3000/mcp" },
  },
});

try {
  const connection = await client.connect("demo");
  const tools = await connection.listTools();
  const result = await connection.callTool("echo", {
    message: "Hello from mcp-use",
  });
  console.log(result.content);
} finally {
  await client.close();
}
```

`MCPClient` holds config and lifecycle. `connect()` returns an `MCPConnection` that works with both legacy sessionful and modern sessionless MCP servers.

---

## React

```typescript
import { useMcp } from "@mcp-use/client/react";

function App() {
  const { state, tools, callTool } = useMcp({
    url: "https://api.example.com/mcp",
  });

  if (state !== "ready") return <p>{state}</p>;

  return (
    <ul>
      {tools.map((tool) => (
        <li key={tool.name}>{tool.name}</li>
      ))}
    </ul>
  );
}
```

See [React integration](https://mcp-use.com/docs/typescript/client/usemcp).

---

## Features

| Feature                  | Description                                     |
| ------------------------ | ----------------------------------------------- |
| **HTTP + stdio**         | Streamable HTTP everywhere; stdio on Node       |
| **Protocol negotiation** | Automatic legacy / modern MCP handling          |
| **OAuth**                | Browser and Node providers, callback helpers    |
| **React**                | `useMcp`, `McpClientProvider`, storage adapters |
| **Code mode**            | Optional sandboxed tool execution (VM / E2B)    |
| **Callbacks**            | Sampling, elicitation, notifications            |

---

## Package entry points

| Import                               | Environment                                 |
| ------------------------------------ | ------------------------------------------- |
| `@mcp-use/client`                    | Node (HTTP + stdio, code mode, file config) |
| `@mcp-use/client` (browser bundlers) | Browser / workers (HTTP only)               |
| `@mcp-use/client/react`              | React hooks and provider                    |

---

## Related packages

| Package                                                                | Description              |
| ---------------------------------------------------------------------- | ------------------------ |
| [mcp-use](https://www.npmjs.com/package/mcp-use)                       | Server framework and CLI |
| [@mcp-use/inspector](https://www.npmjs.com/package/@mcp-use/inspector) | Web-based MCP debugger   |

---

## License

MIT
