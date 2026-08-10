<div align="center" style="margin: 0 auto; max-width: 80%;">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_black.svg">
    <img alt="mcp use logo" src="https://raw.githubusercontent.com/mcp-use/mcp-use/main/static/logo_white.svg" width="80%" style="margin: 20px auto;">
  </picture>
</div>

<h1 align="center">@mcp-use/agent</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/@mcp-use/agent" alt="NPM Downloads">
        <img src="https://img.shields.io/npm/dw/@mcp-use/agent.svg"/></a>
    <a href="https://www.npmjs.com/package/@mcp-use/agent" alt="NPM Version">
        <img src="https://img.shields.io/npm/v/@mcp-use/agent.svg"/></a>
    <a href="https://github.com/mcp-use/mcp-use/blob/main/LICENSE" alt="License">
        <img src="https://img.shields.io/github/license/mcp-use/mcp-use" /></a>
    <a href="https://discord.gg/XkNkSkMz3V" alt="Discord">
        <img src="https://dcbadge.limes.pink/api/server/XkNkSkMz3V?style=flat" /></a>
</p>

**Native cross-platform MCP agent** — connect an LLM to MCP servers, run a tool-calling loop, stream steps, and return answers. Works in **Node and browser** from the same import. Part of the [mcp-use](https://github.com/mcp-use/mcp-use) TypeScript framework.

> **Docs:** [Agent overview](https://mcp-use.com/docs/typescript/agent) · [API reference](https://mcp-use.com/docs/typescript/api-reference/agent/mcp-agent)

---

## Install

```bash
npm install @mcp-use/agent
```

Requires Node.js ≥ 22.22.2. `@mcp-use/client` is included as a dependency.

For the LangChain bridge (`import { MCPAgent } from "@mcp-use/agent/langchain"`), also install the peers you use, for example:

```bash
npm install langchain @langchain/openai
```

---

## Quick start

```typescript
import { MCPAgent } from "@mcp-use/agent";

const agent = new MCPAgent({
  llm: "openai/gpt-4o",
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "./"],
    },
  },
});

const result = await agent.run({ prompt: "What is in the current folder?" });
console.log(result);

await agent.close();
```

`run({ prompt })` returns the final answer. Raise `maxSteps` for multi-tool tasks. Always call `close()` when the agent owns its client.

---

## LangChain bridge

Use the same `MCPAgent` class name from a separate entry when you need LangChain models, Langfuse tracing, Server Manager, or AI SDK streaming:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { MCPAgent } from "@mcp-use/agent/langchain";
import { MCPClient } from "@mcp-use/client";

const mcpServers = {
  filesystem: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "./"],
  },
};

const client = new MCPClient({ mcpServers });
const agent = new MCPAgent({
  llm: new ChatOpenAI({ model: "gpt-4o" }),
  client,
});

const result = await agent.run({ prompt: "Summarize the repo README" });
await agent.close();
```

---

## Features

| Feature | Entry | Description |
| --- | --- | --- |
| **Tool-calling loop** | `@mcp-use/agent` | LLM discovers and calls MCP tools until it can answer |
| **Simplified setup** | `@mcp-use/agent` | `"provider/model"` + `mcpServers` — no manual client/LLM wiring |
| **Streaming** | `@mcp-use/agent` | `stream()` for steps, `streamEvents()` for native LLM events |
| **Structured output** | `@mcp-use/agent/langchain` | Zod `schema` on `run({ prompt, schema })` |
| **Memory** | both | Conversation history across `run()` calls |
| **Server Manager** | `@mcp-use/agent/langchain` | Dynamically add MCP servers during a run |
| **Observability** | `@mcp-use/agent/langchain` | Langfuse metadata, tags, and trace flush |
| **Remote agent** | `@mcp-use/agent` | Run against Manufact Cloud by `agentId` |

---

## Package entry points

| Import | Environment | Description |
| --- | --- | --- |
| `@mcp-use/agent` | Node + browser | Native `MCPAgent` (fetch-based LLM drivers) |
| `@mcp-use/agent/langchain` | Node | LangChain `MCPAgent` (optional peer deps) |

In the browser, pass HTTP MCP URLs or live connections from `@mcp-use/client/react`. Stdio `command`/`args` server configs are Node-only.

---

## Examples

See [examples/README.md](./examples/README.md). Run from this package:

```bash
OPENAI_API_KEY=... pnpm exec tsx examples/basic/simplified_agent_example.ts
```

---

## Related packages

| Package | Description |
| --- | --- |
| [@mcp-use/client](https://www.npmjs.com/package/@mcp-use/client) | MCP client (HTTP, stdio, React hooks) |
| [mcp-use](https://www.npmjs.com/package/mcp-use) | Full framework (server + agent + client) |
| [@mcp-use/inspector](https://www.npmjs.com/package/@mcp-use/inspector) | Web-based MCP debugger |

---

## License

MIT
